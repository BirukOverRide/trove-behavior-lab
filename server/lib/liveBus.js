/**
 * In-process pub/sub for real-time admin SSE streams.
 */
const { EventEmitter } = require('events');

const bus = new EventEmitter();
bus.setMaxListeners(100);

/** Ring buffer of recent live events for new SSE subscribers */
const RING_MAX = 80;
const ring = [];

function publish(type, data) {
  const envelope = {
    type,
    data,
    ts: new Date().toISOString(),
  };
  ring.push(envelope);
  if (ring.length > RING_MAX) ring.shift();
  bus.emit('message', envelope);
  bus.emit(type, envelope);
  return envelope;
}

function subscribe(handler) {
  bus.on('message', handler);
  return () => bus.off('message', handler);
}

function getRecent(n = 40) {
  return ring.slice(-n);
}

module.exports = {
  publish,
  subscribe,
  getRecent,
  bus,
};
