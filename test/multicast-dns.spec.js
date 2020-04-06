/* eslint-env mocha */
'use strict'

const chai = require('chai')
const dirtyChai = require('dirty-chai')
const expect = chai.expect
chai.use(dirtyChai)
const multiaddr = require('multiaddr')
const PeerId = require('peer-id')

const MulticastDNS = require('./../src')

describe('MulticastDNS', () => {
  let pA, aMultiaddrs
  let pB, bMultiaddrs
  let pC, cMultiaddrs
  let pD, dMultiaddrs

  before(async function () {
    this.timeout(80 * 1000)

    ;[pA, pB, pC, pD] = await Promise.all([
      PeerId.create(),
      PeerId.create(),
      PeerId.create(),
      PeerId.create()
    ])

    aMultiaddrs = [
      multiaddr('/ip4/127.0.0.1/tcp/20001')
    ]

    bMultiaddrs = [
      multiaddr('/ip4/127.0.0.1/tcp/20002'),
      multiaddr('/ip6/::1/tcp/20002')
    ]

    cMultiaddrs = [
      multiaddr('/ip4/127.0.0.1/tcp/20003'),
      multiaddr('/ip4/127.0.0.1/tcp/30003/ws')
    ]

    dMultiaddrs = [
      multiaddr('/ip4/127.0.0.1/tcp/30003/ws')
    ]
  })

  it('find another peer', async function () {
    this.timeout(40 * 1000)

    const mdnsA = new MulticastDNS({
      peerId: pA,
      multiaddrs: aMultiaddrs,
      broadcast: false, // do not talk to ourself
      port: 50001,
      compat: false
    })

    const mdnsB = new MulticastDNS({
      peerId: pB,
      multiaddrs: bMultiaddrs,
      port: 50001, // port must be the same
      compat: false
    })

    mdnsA.start()
    mdnsB.start()

    const { id } = await new Promise((resolve) => mdnsA.once('peer', resolve))

    expect(pB.toB58String()).to.eql(id.toB58String())

    await Promise.all([mdnsA.stop(), mdnsB.stop()])
  })

  it('only announce TCP multiaddrs', async function () {
    this.timeout(40 * 1000)

    const mdnsA = new MulticastDNS({
      peerId: pA,
      multiaddrs: aMultiaddrs,
      broadcast: false, // do not talk to ourself
      port: 50003,
      compat: false
    })
    const mdnsC = new MulticastDNS({
      peerId: pC,
      multiaddrs: cMultiaddrs,
      port: 50003, // port must be the same
      compat: false
    })
    const mdnsD = new MulticastDNS({
      peerId: pD,
      multiaddrs: dMultiaddrs,
      port: 50003, // port must be the same
      compat: false
    })

    mdnsA.start()
    mdnsC.start()
    mdnsD.start()

    const { id, multiaddrs } = await new Promise((resolve) => mdnsA.once('peer', resolve))

    expect(pC.toB58String()).to.eql(id.toB58String())
    expect(multiaddrs.length).to.equal(1)

    await Promise.all([
      mdnsA.stop(),
      mdnsC.stop(),
      mdnsD.stop()
    ])
  })

  it('announces IP6 addresses', async function () {
    this.timeout(40 * 1000)

    const mdnsA = new MulticastDNS({
      peerId: pA,
      multiaddrs: aMultiaddrs,
      broadcast: false, // do not talk to ourself
      port: 50001,
      compat: false
    })

    const mdnsB = new MulticastDNS({
      peerId: pB,
      multiaddrs: bMultiaddrs,
      port: 50001,
      compat: false
    })

    mdnsA.start()
    mdnsB.start()

    const { id, multiaddrs } = await new Promise((resolve) => mdnsA.once('peer', resolve))

    expect(pB.toB58String()).to.eql(id.toB58String())
    expect(multiaddrs.length).to.equal(2)

    await Promise.all([mdnsA.stop(), mdnsB.stop()])
  })

  it('doesn\'t emit peers after stop', async function () {
    this.timeout(40 * 1000)

    const mdnsA = new MulticastDNS({
      peerId: pA,
      multiaddrs: aMultiaddrs,
      port: 50004, // port must be the same
      compat: false
    })

    const mdnsC = new MulticastDNS({
      peerId: pC,
      multiaddrs: cMultiaddrs,
      port: 50004,
      compat: false
    })

    mdnsA.start()
    await new Promise((resolve) => setTimeout(resolve, 1000))
    await mdnsA.stop()
    mdnsC.start()

    mdnsC.once('peer', () => {
      throw new Error('Should not receive new peer.')
    })

    await new Promise((resolve) => setTimeout(resolve, 5000))
    await mdnsC.stop()
  })

  it('should start and stop with go-libp2p-mdns compat', async () => {
    const mdns = new MulticastDNS({
      peerId: pA,
      multiaddrs: aMultiaddrs,
      port: 50004
    })

    await mdns.start()
    await mdns.stop()
  })

  it('should not emit undefined peer ids', async () => {
    const mdns = new MulticastDNS({
      peerId: pA,
      multiaddrs: aMultiaddrs,
      port: 50004
    })
    await mdns.start()

    return new Promise((resolve, reject) => {
      mdns.on('peer', (peerInfo) => {
        if (!peerInfo) {
          reject(new Error('peerInfo was not set'))
        }
      })

      mdns.mdns.on('response', () => {
        // query.gotResponse is async - we'll bail from that method when
        // comparing the senders PeerId to our own but it'll happen later
        // so allow enough time for the test to have failed if we emit
        // empty PeerInfo objects
        setTimeout(() => {
          resolve()
        }, 100)
      })

      // this will cause us to respond to ourselves
      mdns.mdns.query({
        questions: [{
          name: 'localhost',
          type: 'A'
        }]
      })
    })
  })
})
