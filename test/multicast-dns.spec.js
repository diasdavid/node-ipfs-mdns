/* eslint-env mocha */
'use strict'

const chai = require('chai')
const dirtyChai = require('dirty-chai')
const expect = chai.expect
chai.use(dirtyChai)
const multiaddr = require('multiaddr')
const PeerInfo = require('peer-info')
const PeerId = require('peer-id')
const parallel = require('async/parallel')
const series = require('async/series')

const MulticastDNS = require('./../src')

function createPeer (callback) {
  PeerId.create({ bits: 512 }, (err, id) => {
    if (err) throw err
    PeerInfo.create(id, callback)
  })
}

describe('MulticastDNS', () => {
  let pA
  let pB
  let pC
  let pD

  before(function (done) {
    parallel([
      (cb) => {
        createPeer((err, peer) => {
          expect(err).to.not.exist()

          pA = peer
          pA.multiaddrs.add(multiaddr('/ip4/127.0.0.1/tcp/20001'))
          cb()
        })
      },
      (cb) => {
        createPeer((err, peer) => {
          expect(err).to.not.exist()

          pB = peer
          pB.multiaddrs.add(multiaddr('/ip4/127.0.0.1/tcp/20002'))
          pB.multiaddrs.add(multiaddr('/ip6/::1/tcp/20002'))
          cb()
        })
      },
      (cb) => {
        createPeer((err, peer) => {
          expect(err).to.not.exist()
          pC = peer
          pC.multiaddrs.add(multiaddr('/ip4/127.0.0.1/tcp/20003'))
          pC.multiaddrs.add(multiaddr('/ip4/127.0.0.1/tcp/30003/ws'))
          cb()
        })
      },
      (cb) => {
        createPeer((err, peer) => {
          if (err) { cb(err) }
          pD = peer
          pD.multiaddrs.add(multiaddr('/ip4/127.0.0.1/tcp/30003/ws'))
          cb()
        })
      }
    ], done)
  })

  it('find another peer', function (done) {
    const options = {
      port: 50001 // port must be the same
    }
    const mdnsA = new MulticastDNS(pA, {
      broadcast: false, // do not talk to ourself
      port: 50001
    })
    const mdnsB = new MulticastDNS(pB, options)

    mdnsA.once('peer', (peerInfo) => {
      expect(pB.id.toB58String()).to.eql(peerInfo.id.toB58String())
      parallel([
        (cb) => mdnsA.stop(cb),
        (cb) => mdnsB.stop(cb)
      ], done)
    })

    mdnsB.once('peer', (peerInfo) => {})
    parallel([
      (cb) => mdnsA.start(cb),
      (cb) => mdnsB.start(cb)
    ], () => {})
  })

  it('only announce TCP multiaddrs', function (done) {
    const options = {
      port: 50003 // port must be the same
    }

    const mdnsA = new MulticastDNS(pA, {
      broadcast: false, // do not talk to ourself
      port: 50003
    })
    const mdnsC = new MulticastDNS(pC, options)
    const mdnsD = new MulticastDNS(pD, options)

    mdnsA.once('peer', (peerInfo) => {
      expect(pC.id.toB58String()).to.eql(peerInfo.id.toB58String())
      expect(peerInfo.multiaddrs.size).to.equal(1)
      parallel([
        (cb) => mdnsA.stop(cb),
        (cb) => mdnsC.stop(cb),
        (cb) => mdnsD.stop(cb)
      ], done)
    })
    mdnsC.once('peer', (peerInfo) => {})
    parallel([
      (cb) => mdnsA.start(cb),
      (cb) => mdnsC.start(cb),
      (cb) => mdnsD.start(cb)

    ], () => {})
  })

  it('announces IP6 addresses', function (done) {
    const options = {
      port: 50001 // port must be the same
    }
    const mdnsA = new MulticastDNS(pA, options)
    const mdnsB = new MulticastDNS(pB, options)

    mdnsA.once('peer', (peerInfo) => {
      expect(pB.id.toB58String()).to.eql(peerInfo.id.toB58String())
      expect(peerInfo.multiaddrs.size).to.equal(2)
      parallel([
        (cb) => mdnsA.stop(cb),
        (cb) => mdnsB.stop(cb)
      ], done)
    })
    mdnsB.once('peer', (peerInfo) => {})
    series([
      (cb) => mdnsB.start(cb),
      (cb) => mdnsA.start(cb)
    ], () => {})
  })

  it('doesn\'t emit peers after stop', function (done) {
    const options = {
      port: 50004 // port must be the same
    }
    const mdnsA = new MulticastDNS(pA, options)
    const mdnsC = new MulticastDNS(pC, options)
    mdnsC.once('peer', (peerInfo) => {
      done(new Error('Should not receive new peer.'))
    })

    series([
      (cb) => mdnsA.start(cb),
      (cb) => setTimeout(cb, 1000),
      (cb) => mdnsA.stop(cb),
      (cb) => mdnsC.start(cb)
    ], () => {
      setTimeout(() => mdnsC.stop(done), 1000)
    })
  })

  it('find all peers', function (done) {
    const options = {
      port: 50001 // port must be the same
    }
    const mdnsA = new MulticastDNS(pA, options)
    const mdnsB = new MulticastDNS(pB, options)
    const mdnsC = new MulticastDNS(pC, options)
    const peersA = {}
    const peersB = {}
    const peersC = {}

    // After all the peers have started, each peer should see two other peers.
    function check (receiver, peerInfo) {
      receiver[peerInfo.id.toB58String()] = true
      if (Object.keys(peersA).length === 2 && Object.keys(peersB).length === 2 && Object.keys(peersC).length === 2) {
        parallel([
          (cb) => mdnsA.stop(cb),
          (cb) => mdnsB.stop(cb),
          (cb) => mdnsC.stop(cb)
        ], done)
      }
    }
    mdnsA.on('peer', (peerInfo) => check(peersA, peerInfo))
    mdnsB.on('peer', (peerInfo) => check(peersB, peerInfo))
    mdnsC.on('peer', (peerInfo) => check(peersC, peerInfo))
    series([
      (cb) => mdnsA.start(cb),
      (cb) => setTimeout(cb, 500),
      (cb) => mdnsB.start(cb),
      (cb) => setTimeout(cb, 500),
      (cb) => mdnsC.start(cb)
    ], () => {})
  })
})
