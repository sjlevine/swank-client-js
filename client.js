var php = require('phpjs');
var net = require('net');
var paredit = require('paredit.js');
var Q = require('q');

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
    presentation_print: function(m) {},
    new_package: function(p) {},
    disconnect: function() {}
  }

  // Bootstrap the reading state
  this.setup_read(6, this.header_complete_callback);
}



/*****************************************************************
 Low-level data handling protocol
 */

Client.prototype.send_message = function(msg) {
  var msg_utf8 = php.utf8_encode(msg);
  // Construct the length, which is a 6-byte
  // hexadecimal length string
  var len_str = msg_utf8.length.toString(16);
  len_str = Array((6 - len_str.length) + 1).join('0') + len_str;
  // Assemble overall message
  var msg_overall = len_str + msg_utf8;
  // Send it
  // console.log("Write:")
  // console.log("    Length: " + len_str + " (" + msg_utf8.length + ")");
  // console.log("    Msg: ...");
  this.socket.write(msg_overall);
}


Client.prototype.connect = function() {
  // Create a socket
  var deferred = Q.defer();
  var sc = this; // Because the 'this' operator changes scope
  this.socket = net.connect({
      host: this.host,
      port: this.port
    }, deferred.resolve);
  this.socket.setNoDelay(true);
  this.socket.setEncoding('ascii');

  this.socket.on('data', function(data) {
    sc.socket_data_handler(data);
  });
  this.socket.on('end', function() {
    sc.on_handlers.disconnect();
  });

  return deferred.promise;
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

Client.prototype.on_swank_message = function(msg) {
    var ast = paredit.parse(msg);
    var sexp = ast.children[0];
    var cmd = sexp.children[0].source.toLowerCase();
    if (cmd == ":return") {
        this.swank_message_rex_return_handler(sexp);
    } else if (cmd == ':write-string') {
        this.on_handlers.presentation_print(sexp.children[1].source.slice(1,-1));
    } else if (cmd == ":new-package") {
        this.on_handlers.new_package(sexp.children[1].source.slice(1, -1));
    } else {
        console.log("Ignoring command " + cmd);
    }

}



/*****************************************************************
 Evaluating EMACS-REX (remote execution) commands
 */

Client.prototype.rex = function(cmd, pkg, thread) {
    // Run an EMACS-REX command, and call the callback
    // when we have a return value, with the parsed paredit s-expression
    // Add an entry into our table!
    var deferred = Q.defer();
    var id = this.req_counter;
    this.req_counter = this.req_counter + 1;
    this.req_table[id] = {
        id: id,
        cmd: cmd,
        pkg: pkg,
        deferred: deferred
    };

    // Dispatch a command to swank
    var rex_cmd = "(:EMACS-REX " + cmd + " \"" + pkg + "\" " + thread + " " + id + ")";
    console.log(rex_cmd);
    this.send_message(rex_cmd);
    return deferred.promise;
}

Client.prototype.swank_message_rex_return_handler = function(cmd) {
    var status = cmd.children[1].children[0].source.toLowerCase();
    var return_val = cmd.children[1].children[1];
    var id = cmd.children[2].source;

    // Look up the appropriate callback and return it!
    if (id in this.req_table) {
        var req = this.req_table[id];
        delete this.req_table[id];
        // console.log("Resolving " + id);
        req.deferred.resolve(return_val);
    } else {
        console.error("Received REX response for unknown command ID");
    }
}

/*****************************************************************
 Higher-level commands
 */
Client.prototype.initialize = function() {
  // Run these useful initialization commands one after another
  var self = this;
  return self.rex("(SWANK:SWANK-REQUIRE  \
    '(SWANK-IO-PACKAGE::SWANK-TRACE-DIALOG SWANK-IO-PACKAGE::SWANK-PACKAGE-FU \
      SWANK-IO-PACKAGE::SWANK-PRESENTATIONS SWANK-IO-PACKAGE::SWANK-FUZZY \
      SWANK-IO-PACKAGE::SWANK-FANCY-INSPECTOR SWANK-IO-PACKAGE::SWANK-C-P-C \
      SWANK-IO-PACKAGE::SWANK-ARGLISTS SWANK-IO-PACKAGE::SWANK-REPL))", 'COMMON-LISP-USER', 'T')
      .then(function(response) {
        return self.rex("(SWANK:INIT-PRESENTATIONS)", 'COMMON-LISP-USER', 'T');})
      .then(function(response) {
        return self.rex('(SWANK-REPL:CREATE-REPL NIL :CODING-SYSTEM "utf-8-unix")', 'COMMON-LISP-USER', 'T');});
}

/* Gets autodocumentation for the given sexp, given the cursor's position */
Client.prototype.autodoc = function(sexp_string, cursor_position, pkg) {
  var ast = paredit.parse(sexp_string);
  try {
    var forms = ast.children[0];
    var output_forms = [];
    var didCursor = false;
    for(var i = 0; i < forms.children.length; i++) {
      var form = forms.children[i];
      output_forms.push('"' + form.source + '"');
      if (cursor_position >= form.start && cursor_position <= form.end && !didCursor) {
        output_forms.push('SWANK::%CURSOR-MARKER%');
        didCursor = true;
        break;
      }
    }
    if (!didCursor) {
      output_forms.push('""');
      output_forms.push('SWANK::%CURSOR-MARKER%');
      didCursor = true;
    }
    var cmd = '(SWANK:AUTODOC \'('; // '"potato" SWANK::%CURSOR-MARKER%) :PRINT-RIGHT-MARGIN 80)';
    cmd += output_forms.join(' ');
    cmd += ') :PRINT-RIGHT-MARGIN 80)';
  } catch (e) {
    // Return a promise with nothing then
    console.log("Error constructing command: " + e.toString());
    return Q({type: 'symbol', source: ':not-available'});
  }
  // Return a promise that will yield the result.
  return this.rex(cmd, pkg, ':REPL-THREAD')
    .then(function (ast) {
      try {
        return ast.children[0];
      } catch (e) {
        return {type: 'symbol', source: ':not-available'};
      }
    });
}

Client.prototype.eval = function(sexp_string, pkg) {
  var cmd = '(SWANK-REPL:LISTENER-EVAL "' + sexp_string.replace(/\"/g, '\\"') + '")';
  return this.rex(cmd, pkg, ':REPL-THREAD');
}


module.exports.Client = Client;
