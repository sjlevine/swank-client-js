m = require('./client.js');

sc = new m.SwankClient("localhost", 4005);
sc.on('connect', function() {
  console.log("Connected!!");
  sc.send_message("(:EMACS-REX (SWANK:CONNECTION-INFO) \"COMMON-LISP-USER\" T 1)");
});
sc.on('data', function(data) {
  console.log("Read message of length " + data.toString().length);
})
sc.on('disconnect', function() {
  console.log("Disconnected!")
})


sc.connect("localhost", 4005);
