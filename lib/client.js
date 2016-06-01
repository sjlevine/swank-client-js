var php = require('phpjs');
var net = require('net');
var paredit = require('paredit.js');

/* Swank client class! */

function Client(host, port) {
  this.host = host;
  this.port = port;
  this.socket = null;
  this.connected = false;

  // Useful protocol information
  this.req_counter = 1;
  this.req_table = {};

  this.on_handlers = {
    connect: function() {},
    print_string: function(m) {},
    presentation_start: function (pid) {},
    presentation_end: function (pid) {},
    new_package: function(p) {},
    debug_activate: function(obj) {},
    debug_setup: function(obj) {},
    debug_return: function(obj) {},
    disconnect: function() {}
  }

  // Bootstrap the reading state
  this.setup_read(6, this.header_complete_callback);
}



/*****************************************************************
 Low-level data handling protocol
 *****************************************************************/

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
  console.log(msg_overall) // Great for debugging!
  this.socket.write(msg_overall);
}


Client.prototype.connect = function() {
  var sc = this; // Because the 'this' operator changes scope
  return new Promise(function(resolve, reject) {
    // Create a socket
    sc.socket = net.connect({
        host: sc.host,
        port: sc.port
      }, function() {
        sc.connected = true;
        resolve();
      });
    sc.socket.setNoDelay(true);
    sc.socket.setEncoding('ascii');

    sc.socket.on('error', function(err) {
      reject();
    })
    sc.socket.on('data', function(data) {
      sc.socket_data_handler(data);
    });
    sc.socket.on('end', function() {
      sc.connected = false;
      sc.on_handlers.disconnect();
    });
  });
}

/* Some data just came in over the wire. Make sure to read it in
message chunks with the length */
Client.prototype.socket_data_handler = function(data) {
  var d = data.toString();
  // console.log("Raw data: " + d);
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
  try {
    this.on_swank_message(php.utf8_decode(data))
  } catch (e) {
    console.log("Error in swank-js callback");
  }

  // Set up again to read the header
  this.setup_read(6, this.header_complete_callback); // It's 6 bytes long
}

Client.prototype.on = function(event, fn) {
  this.on_handlers[event] = fn;
}

Client.prototype.on_swank_message = function(msg) {
  console.log(msg); // Great for debugging!
  var ast = paredit.parse(msg);
  var sexp = ast.children[0];
  var cmd = sexp.children[0].source.toLowerCase();
  if (cmd == ":return") {
    this.swank_message_rex_return_handler(sexp);
  } else if (cmd == ':write-string') {
    this.on_handlers.print_string(sexp.children[1].source.slice(1,-1).replace(/\\\\/g, "\\"));
  } else if (cmd == ':presentation-start') {
    var presentation_id = sexp.children[1].source;
    this.on_handlers.presentation_start(presentation_id);
  } else if (cmd == ':presentation-end') {
    var presentation_id = sexp.children[1].source;
    console.log(presentation_id);
    this.on_handlers.presentation_end(presentation_id);
  } else if (cmd == ":new-package") {
    this.on_handlers.new_package(sexp.children[1].source.slice(1, -1).replace(/\\\\/g, "\\"));
  } else if (cmd == ":debug") {
    this.debug_setup_handler(sexp);
  } else if (cmd == ":debug-activate") {
    this.debug_activate_handler(sexp);
  } else if (cmd == ":debug-return") {
    this.debug_return_handler(sexp);
  } else if (cmd == ":ping") {
    this.ping_handler(sexp);
  } else {
    // console.log("Ignoring command " + cmd);
  }

}



/*****************************************************************
 Evaluating EMACS-REX (remote execution) commandsreturn ast.children[0].children.map(function(competion) {
          return competion.source.slice(1, -1);
        })
 */

Client.prototype.rex = function(cmd, pkg, thread) {
  // Run an EMACS-REX command, and call the callback
  // when we have a return value, with the parsed paredit s-expression
  // Add an entry into our table!
  var sc = this;
  var resolve_fn = null;
  var id = sc.req_counter;
  var promise = new Promise(function(resolve, reject) {
    // Dispatch a command to swank
    resolve_fn = resolve;
    var rex_cmd = "(:EMACS-REX " + cmd + " \"" + pkg + "\" " + thread + " " + id + ")";
    // console.log(rex_cmd);
    sc.send_message(rex_cmd);
  });

  sc.req_counter = sc.req_counter + 1;
  sc.req_table[id] = {
    id: id,
    cmd: cmd,
    pkg: pkg,
    promise_resolve_fn: resolve_fn
  };
  return promise;
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
        req.promise_resolve_fn(return_val);
    } else {
        console.error("Received REX response for unknown command ID");
    }
}


Client.prototype.ping_handler = function(sexp) {
  // Swank occasionally send's ping messages to see if we're okay.
  // We must respond!
  var response = '(:EMACS-PONG ' + sexp.children[1].source + ' ' + sexp.children[2].source + ')';
  this.send_message(response);
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
      output_forms.push('"' + form.source.replace(/\\/g, "\\\\").replace(/\"/g, "\\\"") + '"');
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
    return Promise.resolve({type: 'symbol', source: ':not-available'});
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

Client.prototype.autocomplete = function(prefix, pkg) {
  prefix = prefix.replace(/\\/g, "\\\\").replace(/\"/g, "\\\"");
  // TODO - do we need to escape the above prefix more?
  var cmd = '(SWANK:SIMPLE-COMPLETIONS "' + prefix + '" \'"' + pkg + '")';
  return this.rex(cmd, pkg, "T")
    .then(function (ast) {
      try {
        return ast.children[0].children.map(function(competion) {
          return competion.source.slice(1, -1);
        });
      } catch (e) {
        return [];
      }
    });
}


Client.prototype.eval = function(sexp_string, pkg) {
  var cmd = '(SWANK-REPL:LISTENER-EVAL "' + sexp_string.replace(/\\/g, "\\\\").replace(/\"/g, "\\\"") + '")';
  return this.rex(cmd, pkg, ':REPL-THREAD');
}


Client.prototype.debug_setup_handler = function(sexp) {
  var obj = {};
  obj.thread = sexp.children[1].source;
  obj.level = sexp.children[2].source;
  obj.title = sexp.children[3].children[0].source.slice(1, -1);
  obj.type = sexp.children[3].children[1].source.slice(1, -1);
  obj.restarts = [];
  sexp.children[4].children.forEach(function(restart_sexp) {
    obj.restarts.push({
      cmd: restart_sexp.children[0].source.slice(1, -1),
      description: restart_sexp.children[1].source.slice(1, -1)
    });
  });
// TODO: stack trace

  this.on_handlers.debug_setup(obj);
}

Client.prototype.debug_activate_handler = function(sexp) {
  var thread = sexp.children[1].source;
  var level = sexp.children[2].source;
  this.on_handlers.debug_activate({thread: thread, level: level});
}

Client.prototype.debug_return_handler = function(sexp) {
  var thread = sexp.children[1].source;
  var level = sexp.children[2].source;
  this.on_handlers.debug_return({thread: thread, level: level});
}

Client.prototype.debug_invoke_restart = function(level, restart, thread) {
  var cmd = '(SWANK:INVOKE-NTH-RESTART-FOR-EMACS ' + level + ' ' + restart + ')';
  return this.rex(cmd, 'COMMON-LISP-USER', thread);
}

/* Escape from all errors */
Client.prototype.debug_escape_all = function() {
  var cmd = '(SWANK:THROW-TO-TOPLEVEL)';
  return this.rex(cmd, "COMMON-LISP-USER", "1"); //# TODO - is "1" ok here?
}

// Returns function definitions. Returns a list of objects, each of which has a
// label property, a filename, and an index
Client.prototype.find_definitions = function(fn, pkg) {
  var cmd = '(SWANK:FIND-DEFINITIONS-FOR-EMACS "' + fn + '")';
  return this.rex(cmd, pkg, "T")
    .then(function (ast) {
      var refs = [];
      for(var i = 0; i < ast.children.length; i++) {
        try {
          // Extract the filename depending on the response
          var filename = null;
          if (ast.children[i].children[1].children[1].children[0].source.toLowerCase() == ":file") {
            filename = ast.children[i].children[1].children[1].children[1].source.slice(1, -1);
          } else if (ast.children[i].children[1].children[1].children[0].source.toLowerCase() == ":buffer-and-file") {
            filename = ast.children[i].children[1].children[1].children[2].source.slice(1, -1);
          }

          // Push an appropriate reference!
          refs.push({
            label: ast.children[i].children[0].source.slice(1, -1),
            filename: filename,
            index: parseInt(ast.children[i].children[1].children[2].children[1].source)
          });
        } catch (e) {
          // Don't add the reference - it didn't parse correctly
        }
      }
      return refs;
    });
}


Client.prototype.compile_string = function(compile_string, filename, filename_full, position, line, column, package) {
  var cmd = "(SWANK:COMPILE-STRING-FOR-EMACS \"" +  compile_string.replace(/\\/g, "\\\\").replace(/\"/g, "\\\"") + "\" \"" + filename + "\" '((:POSITION " + position + ")) \"" + filename_full + "\" 'NIL)";
  return this.rex(cmd, package, "T");
}


Client.prototype.inspect_presentation = function(presentation_id) {
  var cmd = "(SWANK:INSPECT-PRESENTATION '" + presentation_id + " T)";
  return this.rex(cmd, 'COMMON-LISP-USER', ':REPL-THREAD');
}


Client.prototype.get_type_of_presentation_object = function(presentation_id) {
  var cmd_desired = "(let ((object (swank:lookup-presented-object '" + presentation_id + "))) (cond ((typep object 'string) \"string\") ((typep object 'character) \"character\") ((typep object 'number) \"number\") ((typep object 'boolean) \"boolean\") ((typep object 'symbol) \"symbol\") ((typep object 'list) \"list\") ((typep object 'array) \"array\") ((typep object 'hash-table) \"hash-table\") (T \"other\")))";
  var cmd = "(SWANK:EVAL-AND-GRAB-OUTPUT \"" + cmd_desired.replace(/\\/g, "\\\\").replace(/\"/g, "\\\"") + "\")";
  return this.rex(cmd, 'COMMON-LISP-USER', ':REPL-THREAD');
}


Client.prototype.get_type_of_inspection_nth_part = function(index) {
  // inspector-nth-part
  var cmd_desired = "(let ((object (swank:inspector-nth-part " + index + "))) (cond ((typep object 'string) \"string\") ((typep object 'character) \"character\") ((typep object 'number) \"number\") ((typep object 'boolean) \"boolean\") ((typep object 'symbol) \"symbol\") ((typep object 'list) \"list\") ((typep object 'array) \"array\") ((typep object 'hash-table) \"hash-table\") (T \"other\")))";
  var cmd = "(SWANK:EVAL-AND-GRAB-OUTPUT \"" + cmd_desired.replace(/\\/g, "\\\\").replace(/\"/g, "\\\"") + "\")";
  return this.rex(cmd, 'COMMON-LISP-USER', ':REPL-THREAD');
}


Client.prototype.interrupt = function() {
  var cmd = '(:EMACS-INTERRUPT :REPL-THREAD)';
  this.send_message(cmd);
}


Client.prototype.quit = function() {
  var cmd = '(SWANK/BACKEND:QUIT-LISP)';
  return this.rex(cmd, "COMMON-LISP-USER", "T")
}


module.exports.Client = Client;
