var Swank = require('./client.js');

var sc = new Swank.Client("localhost", 4005);
sc.on('connect', function() {
  console.log("Connected!!");
  sc.rex("(SWANK:CONNECTION-INFO)", "COMMON-LISP-USER", "T", 2);
});
sc.on('disconnect', function() {
  console.log("Disconnected!")
})


sc.connect("localhost", 4005);
