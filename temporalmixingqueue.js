/**
 * Copyright reelyActive 2014
 * We believe in an open Internet of Things
 */
 
var reelib = require('reelib');
var events = require('events');
var Datastore = require('nedb');
var util = require('util');
 
var DEFAULT_DELAY = 25;
var DEFAULT_SIGNATURES_SPECIFIC_DELAY = true;
var DEFAULT_ALLOW_DUPLICATES = true;
 
 
/**
 * TemporalMixingQueue Class
 * Groups, based on time, objects which share a common string.
 * @param {Object} options The options as a JSON object.
 * @constructor
 * @extends {events.EventEmitter}
 */
 
function TemporalMixingQueue(options) {
 
  var self = this;
 
  var options = options || {};
  self.delayms = options.mixingDelayMilliseconds || DEFAULT_DELAY;
  self.signatureSpecificDelay = options.signatureSpecificDelay && DEFAULT_SIGNATURES_SPECIFIC_DELAY;
  self.allowDuplicates  = options.allowDuplicates && DEFAULT_ALLOW_DUPLICATES;
  self.binded = false;
  self.emitters = [];
  self.signatures = []; // A Queue of pairs signature-timeout
  self.db = new Datastore();
 
  events.EventEmitter.call(self);
}
util.inherits(TemporalMixingQueue, events.EventEmitter);
 
 
/**
 * Keep passing itself in callback so it is kept alive. 
 * At each signature, it asks itself whether it should sleep or consume the queue.
 */
 
TemporalMixingQueue.prototype.handleTemporalMixingQueue = function() {
 
  var self = this;
  var sleepTime = timeToSleep(self);
  
  if(sleepTime) {
    sleepAndResume(self,sleepTime);
  }
  else {
    self.consumeQueue(self.handleTemporalMixingQueue);
  }
}
 
 
/**
 * Push the packetArray corresponding to the signature.
 * Dequeue the first signature.
 * Nothing of the packetArray nor the signature is left once done.
 */
 
TemporalMixingQueue.prototype.consumeQueue = function() {
 
  var self = this;
  var signatureValue = self.signatures[0].value;
 
  getPackets(self, signatureValue, function(signatureValue, self, packetArray) {
    cleanPackets(packetArray);
    self.emit('decodedRadioSignalPacketArray', packetArray);
    deletePackets(self, signatureValue, function(self, signatureValue) {
      self.signatures.shift();
      self.handleTemporalMixingQueue();
    });
  }); 
}
 
 
/**
 * Insert a packet in the database. 
 * Enqueue the signature if needed.
 * @param {packet} packet to be inserted into the database.
 */
 
TemporalMixingQueue.prototype.produceQueue = function(packet) {
 
  var self = this;
  var signatureValue = packet.identifier.value;
  var signatureAlreayPresent = isSignaturePresent(self,signatureValue);
 
    if(signatureAlreayPresent) {
      self.db.insert(packet);
    }
    else {
      addSignature(self,signatureValue);
      self.db.insert(packet);
    }
}
 
 
/**
 * Insert a packet in the database.
 * If packet is a duplicate, pushout its corresponding signature.
 * Update/add signature when needed.
 * @param {packet} packet to be inserted into the database.
 */
 
TemporalMixingQueue.prototype.produceQueueNoDuplicate = function (packet) {
 
  var self = this;
  var signatureValue = packet.identifier.value;
  var origin = packet.origin;
  var signatureAlreayPresent = isSignaturePresent(self,signatureValue);
 
  if(signatureAlreayPresent) {
     countDuplicate(self, signatureValue, origin, packet, function(self, packet, count) {
      if(count > 0) {
        getPackets(self, signatureValue, function(signatureValue, self, packetArray) {
          cleanPackets(packetArray);
          self.emit('decodedRadioSignalPacketArray', packetArray);
          deletePackets(self, signatureValue, function(self, signatureValue) {
            updateSignature(self, signatureValue);
            self.db.insert(packet);
          });
        }); 
      }
      else {
        self.db.insert(packet);
      }
    });
  }
  else {
    addSignature(self,signatureValue);
    self.db.insert(packet);
  }
}
 
 
/**
 * Bind the temporal mixing queue to an event emitter.
 * @param {ListenerService} emitter ListenerService.
 */
 
TemporalMixingQueue.prototype.bind = function(emitter) {
 
  var self = this;
  
  self.emitters.push(emitter);
 
  emitter.on('decodedRadioSignalPacket', function(packet) {
    if(self.allowDuplicates) {
      self.produceQueue(packet);
    }
    else {
      self.produceQueueNoDuplicate(packet);
    }
  });
 
  if(self.binded === false) {
    self.handleTemporalMixingQueue(); 
    self.binded = true;
  } 
}
 
 
/**
 * Return the amount of time the consumer needs to sleep.
 * @param {instance} instance of a temporal mixing queue.
 */
 
function timeToSleep (instance) {
   
  var timeToSleep = 0;
 
  if(instance.signatures[0]) {
    if(instance.signatureSpecificDelay) {
      return Math.max(0, instance.signatures[0].timeOut - reelib.time.getCurrent());
    }
    else {
      return 0;
    }
  }
  else {
    return instance.delayms;
  }
}
 
/**
 * Short function meant to help readibility.
 * @param {instance} instance of temporal mixing queue.
 * @param {sleepTime} the amount of time to sleep.
 */
 
function sleepAndResume (instance, sleepTime) {
  setTimeout(instance.handleTemporalMixingQueue.bind(instance), sleepTime);
}
 
 
/**
 * Construct and enqueue a signature.
 * @param {instance} instance of temporal mixing queue.
 * @param {signatureValue} the signature to enqueue. 
 */
 
function addSignature (instance, signatureValue) {
  var signatureTimeOut = reelib.time.getFuture(instance.delayms);
  instance.signatures.push({'value' : signatureValue, 'timeOut' : signatureTimeOut});
}
 
/**
 * Check if there is a signature with the corresponding value.
 * @param {instance} instance of temporal mixing queue.
 * @param {signatureValue} the signature to enqueue. 
 */
 
function isSignaturePresent (instance, signatureValue) {
  for(var i = 0; i < instance.signatures.length; i++) {
    if(instance.signatures[i].value === signatureValue) return true
  }
  return false;
}
 
 
/**
 * Retrieve the packets with corresponding signature.
 * @param {instance} instance of temporal mixing queue.
 * @param {signatureValue} the signature to enqueue. 
 * @param {callback} callback Function to call upon completion.
 */
 
function getPackets(instance, signatureValue, callback) {
  instance.db.find({'identifier.value' : signatureValue}, function (err, packetArray) {
    callback(signatureValue, instance, packetArray);
  });
}
 
 
/**
 * Removed the _id property that nedb added to our packets.
 * @param {packetArray} the array of packets to clean.
 */
 
function cleanPackets(packetArray) {
  for(var i = 0; i < packetArray.length; i++) {
    delete packetArray[i]._id;
  }
}
 
 
/**
 * Delete the packets with corresponding signature.
 * @param {instance} instance of temporal mixing queue.
 * @param {signatureValue} deleting packets with this signature.
 * @param {callback} callback Function to call upon completion.
 */
 
function deletePackets(instance, signatureValue, callback) {
  instance.db.remove({'identifier.value' : signatureValue},{multi: true}, function () {
    callback(instance, signatureValue);
  });
}
 
 
/**
 * Update the signature by refreshing its timeout and moving it to the back of the queue.
 * @param {instance} instance of temporal mixing queue.
 * @param {signatureValue} signature to be updated.
 */
 
function updateSignature(instance, signatureValue) {
  instance.signatures.splice(instance.signatures.indexOf(signatureValue),1); // Delete the signature
  var signatureTimeOut = reelib.time.getFuture(instance.delayms);
  instance.signatures.push({'value' : signatureValue, 'timeOut' : signatureTimeOut});
}
 
 
/**
 * Count the number of duplicates of packet (matching signature and matching origin).
 * @param {instance} instance of temporal mixing queue.
 * @param {signatureValue} packet's signature.
 * @param {origin} packet's origin.
 * @param {packet} packet to be compared for duplication.
 * @param {callback} callback Function to call upon completion.
 */
 
function countDuplicate (instance, signatureValue, origin, packet, callback) {
  var tagToCount = { 'identifier.value' : signatureValue, 'origin' : origin };
  instance.db.count(tagToCount, function (err, count) {
    callback(instance, packet, count);
  });  
}
 
 
module.exports = TemporalMixingQueue;
