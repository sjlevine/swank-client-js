php = require('phpjs');
net = require('net');

/* Swank client class! */
function SwankClient(host, port) {
  this.host = host;
  this.port = port;
  this.socket = null;

  this.on_handlers = {
    connect: function() {},
    data: function(data) {},
    disconnect: function() {}
  }

  // Bootstrap the reading state
  this.setup_read(6, this.header_complete_callback);

}


SwankClient.prototype.send_message = function(msg) {
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

SwankClient.prototype.connect = function() {
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
SwankClient.prototype.socket_data_handler = function(data) {
  var d = data.toString();

  while (d.length > 0) {
    if (d.length >= this.len_remaining) {
      // We can finish this buffer! Read the remaining
      // and reduce from d.
      this.buffer += d.slice(0, this.len_remaining);
      d = d.slice(this.len_remaining);
      this.buffer_complete_callback(this.buffer);
    } else {
      // We haven't read enough to complete the desired
      // read length yet. Consume it and update.
      this.buffer += d;
      d = "";
    }
  }
}

SwankClient.prototype.setup_read = function(length, fn) {
  this.buffer = "";
  this.len_remaining = length;
  this.buffer_complete_callback = fn;
}

SwankClient.prototype.header_complete_callback = function(data) {
  // Parse the length
  var len = parseInt(data, 16);
  // Set up to read data
  this.setup_read(len, this.data_complete_callback);
}

SwankClient.prototype.data_complete_callback = function(data) {
  // Call the handler
  this.on_handlers.data(php.utf8_decode(data));
  // Set up again to read the header
  this.setup_read(6, this.header_complete_callback); // It's 6 bytes long
}


SwankClient.prototype.on = function(event, fn) {
  this.on_handlers[event] = fn;
}




//
// var net = require('net');
// var client = net.connect({port: 8124},
//     function() { //'connect' listener
//   console.log('connected to server!');
//   client.write('world!\r\n');
// });
// client.on('data', function(data) {
//   console.log(data.toString());
//   client.end();
// });
// client.on('end', function() {
//   console.log('disconnected from server');
// });



// node.js module exports
module.exports.SwankClient = SwankClient;
