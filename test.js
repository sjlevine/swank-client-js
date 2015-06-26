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
  return sc.rex("(SWANK:CONNECTION-INFO)", "COMMON-LISP-USER", "T")})
.then(function(result) {
  console.log("Got response: " + result.toString());});
