var php = require('phpjs');
var net = require('net');
var paredit = require('paredit.js');

/* Swank client class! */

function Client(host, port) {
  this.host = host;
  this.port = port;
  this.socket = null;

  // Useful protocol information
  this.req_counter = 1;
  this.req_table = {};

  this.on_handlers = {
    connect: function() {},
    disconnect: function() {}
  }

  // Bootstrap the reading state
  this.setup_read(6, this.header_complete_callback);
}


Client.prototype.send_message = function(msg) {
  var msg_utf8 = php.utf8_encode(msg);
  // Construct the length, which is a 6-byte
  // hexadecimal length string
  var len_str = msg_utf8.length.toString(16);
  len_str = Array((6 - len_str.length) + 1).join('0') + len_str;
  // Assemble overall message
  var msg_overall = len_str + msg_utf8;
  // Send it
  this.socket.write(msg_overall);
}


Client.prototype.connect = function() {
  // Create a socket
  var sc = this; // Because the 'this' operator changes scope
  this.socket = net.connect({
      host: this.host,
      port: this.port
    }, function() {
      sc.on_handlers.connect();
  });
  this.socket.setEncoding('ascii');

  this.socket.on('data', function(data) {
    sc.socket_data_handler(data);
  });
  this.socket.on('end', function() {
    sc.on_handlers.disconnect();
  });
}

/* Some data just came in over the wire. Make sure to read it in
message chunks with the length */
Client.prototype.socket_data_handler = function(data) {
  var d = data.toString();

  while (d.length > 0) {
    if (d.length >= this.len_remaining) {
      // We can finish this buffer! Read the remaining
      // and reduce from d.
      // console.log("Consuming " + this.len_remaining + " of " + d.length);
      this.buffer += d.slice(0, this.len_remaining);
      d = d.slice(this.len_remaining);
      this.len_remaining = 0;
    } else {
      // We haven't read enough to complete the desired
      // read length yet. Consume it and update.
      // console.log("Consuming all " + d.length);
      this.buffer += d;
      this.len_remaining = this.len_remaining - d.length;
      d = "";
    }

    // If we've finished reading the entire buffer, call the callback!
    // console.log("Len Remaining: " + this.len_remaining);
    if (this.len_remaining == 0) {
        // console.log("   Buffer complete!");
        // console.log("   d left: " + d.length);
        this.buffer_complete_callback(this.buffer);
    }
  }
}

Client.prototype.setup_read = function(length, fn) {
  this.buffer = "";
  this.len_remaining = length;
  this.buffer_complete_callback = fn;
}

Client.prototype.header_complete_callback = function(data) {
  // Parse the length
  var len = parseInt(data, 16);
  // Set up to read data
  this.setup_read(len, this.data_complete_callback);
}

Client.prototype.data_complete_callback = function(data) {
  // Call the handler
  this.on_swank_message(php.utf8_decode(data))

  // Set up again to read the header
  this.setup_read(6, this.header_complete_callback); // It's 6 bytes long
}

Client.prototype.on = function(event, fn) {
  this.on_handlers[event] = fn;
}


Client.prototype.rex = function(cmd, package, thread, callback) {
    // Run an EMACS-REX command, and call the callback
    // when we have a return value, with the parsed paredit s-expression
    // Add an entry into our table!
    var id = this.req_counter;
    this.req_counter = this.req_counter + 1;
    this.req_table[id] = {
        id: id,
        cmd: cmd,
        package: package,
        callback: callback
    };

    // Dispatch a command to swank
    var rex_cmd = "(:EMACS-REX " + cmd + " \"" + package + "\" " + thread + " " + id + ")";
    this.send_message(rex_cmd);
}

Client.prototype.on_swank_message = function(msg) {
    var ast = paredit.parse(msg);
    var sexp = ast.children[0];
    var cmd = sexp.children[0].source.toLowerCase();
    if (cmd == ":return") {
        this.swank_message_rex_return_handler(sexp);
    } else {
        console.log("Ignoring command " + cmd);
    }

}

Client.prototype.swank_message_rex_return_handler = function(cmd) {
    var status = cmd.children[1].children[0].source.toLowerCase();
    var return_val = cmd.children[1].children[1];
    var id = cmd.children[2].source;

    // Look up the appropriate callback and return it!
    if (id in this.req_table) {
        var req = this.req_table[id];
        delete this.req_table[id];
        req.callback(return_val);
    } else {
        console.error("Received REX response for unknown command ID");
    }


}


module.exports.Client = Client;
