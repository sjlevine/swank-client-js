var Swank = require('./client.js');
var Q = require('q');

var sc = new Swank.Client("localhost", 4005);


sc.on('disconnect', function() {
  console.log("Disconnected!")
})


sc.connect("localhost", 4005)
.then(function() {
  console.log("Connected!!");
  return sc.initialize();})
.then(function() {
  console.log("Autodoc");
  return sc.autodoc("(+ 1 2)", "COMMON-LISP-USER", 2);})
.then(function(result) {
  console.log("Got response: " + result);});


// return sc.rex("(SWANK:CONNECTION-INFO)", "COMMON-LISP-USER", "T")})
