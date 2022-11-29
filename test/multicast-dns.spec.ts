/* eslint-env mocha */

import { expect } from 'aegir/chai'
import type { Multiaddr } from '@multiformats/multiaddr'
import { multiaddr } from '@multiformats/multiaddr'
import { createEd25519PeerId } from '@libp2p/peer-id-factory'
import pWaitFor from 'p-wait-for'
import { MulticastDNS } from './../src/index.js'
import type { PeerId } from '@libp2p/interface-peer-id'
import type { PeerInfo } from '@libp2p/interface-peer-info'
import { stubInterface } from 'ts-sinon'
import type { AddressManager } from '@libp2p/interface-address-manager'
import { Components } from '@libp2p/components'

function getComponents (peerId: PeerId, multiaddrs: Multiaddr[]) {
  const addressManager = stubInterface<AddressManager>()
  addressManager.getAddresses.returns(multiaddrs)

  return new Components({ peerId, addressManager })
}

describe('MulticastDNS', () => {
  let pA: PeerId
  let aMultiaddrs: Multiaddr[]
  let pB: PeerId
  let bMultiaddrs: Multiaddr[]
  let cMultiaddrs: Multiaddr[]
  let pD: PeerId
  let dMultiaddrs: Multiaddr[]

  before(async function () {
    this.timeout(80 * 1000)

    ;[pA, pB, pD] = await Promise.all([
      createEd25519PeerId(),
      createEd25519PeerId(),
      createEd25519PeerId()
    ])

    aMultiaddrs = [
      multiaddr('/ip4/127.0.0.1/tcp/20001'),
      multiaddr('/dns4/webrtc-star.discovery.libp2p.io/tcp/443/wss/p2p-webrtc-star'),
      multiaddr('/dns4/discovery.libp2p.io/tcp/8443')
    ]

    bMultiaddrs = [
      multiaddr('/ip4/127.0.0.1/tcp/20002'),
      multiaddr('/ip6/::1/tcp/20002'),
      multiaddr('/dnsaddr/discovery.libp2p.io')
    ]

    cMultiaddrs = [
      multiaddr('/ip4/127.0.0.1/tcp/20003'),
      multiaddr('/ip4/127.0.0.1/tcp/30003/ws'),
      multiaddr('/dns4/discovery.libp2p.io')
    ]

    dMultiaddrs = [
      multiaddr('/ip4/127.0.0.1/tcp/30003/ws')
    ]
  })

  it('find another peer', async function () {
    this.timeout(40 * 1000)

    const mdnsA = new MulticastDNS({
      broadcast: false, // do not talk to ourself
      port: 50001,
      compat: false
    })
    mdnsA.init(getComponents(pA, aMultiaddrs))

    const mdnsB = new MulticastDNS({
      port: 50001, // port must be the same
      compat: false
    })
    mdnsB.init(getComponents(pB, bMultiaddrs))

    await mdnsA.start()
    await mdnsB.start()

    const { detail: { id } } = await new Promise<CustomEvent<PeerInfo>>((resolve) => mdnsA.addEventListener('peer', resolve, {
      once: true
    }))

    expect(pB.toString()).to.eql(id.toString())

    await Promise.all([mdnsA.stop(), mdnsB.stop()])
  })

  it('announces all multiaddresses', async function () {
    this.timeout(40 * 1000)

    const mdnsA = new MulticastDNS({
      broadcast: false, // do not talk to ourself
      port: 50003,
      compat: false
    })
    mdnsA.init(getComponents(pA, aMultiaddrs))
    const mdnsB = new MulticastDNS({
      port: 50003, // port must be the same
      compat: false
    })
    mdnsB.init(getComponents(pB, cMultiaddrs))
    const mdnsD = new MulticastDNS({
      port: 50003, // port must be the same
      compat: false
    })
    mdnsD.init(getComponents(pD, dMultiaddrs))

    await mdnsA.start()
    await mdnsB.start()
    await mdnsD.start()

    const peers = new Map()
    const expectedPeer = pB.toString()

    const foundPeer = (evt: CustomEvent<PeerInfo>) => peers.set(evt.detail.id.toString(), evt.detail)
    mdnsA.addEventListener('peer', foundPeer)

    await pWaitFor(() => peers.has(expectedPeer))
    mdnsA.removeEventListener('peer', foundPeer)

    expect(peers.get(expectedPeer).multiaddrs.length).to.equal(3)

    await Promise.all([
      mdnsA.stop(),
      mdnsB.stop(),
      mdnsD.stop()
    ])
  })

  it('doesn\'t emit peers after stop', async function () {
    this.timeout(40 * 1000)

    const mdnsA = new MulticastDNS({
      port: 50004, // port must be the same
      compat: false
    })
    mdnsA.init(getComponents(pA, aMultiaddrs))

    const mdnsC = new MulticastDNS({
      port: 50004,
      compat: false
    })
    mdnsC.init(getComponents(pD, dMultiaddrs))

    await mdnsA.start()
    await new Promise((resolve) => setTimeout(resolve, 1000))
    await mdnsA.stop()
    await mdnsC.start()

    mdnsC.addEventListener('peer', () => {
      throw new Error('Should not receive new peer.')
    }, {
      once: true
    })

    await new Promise((resolve) => setTimeout(resolve, 5000))
    await mdnsC.stop()
  })

  it('should start and stop with go-libp2p-mdns compat', async () => {
    const mdns = new MulticastDNS({
      port: 50004
    })
    mdns.init(getComponents(pA, aMultiaddrs))

    await mdns.start()
    await mdns.stop()
  })

  it('should not emit undefined peer ids', async () => {
    const mdns = new MulticastDNS({
      port: 50004
    })
    mdns.init(getComponents(pA, aMultiaddrs))
    await mdns.start()

    await new Promise<void>((resolve, reject) => {
      mdns.addEventListener('peer', (evt) => {
        if (evt.detail == null) {
          reject(new Error('peerData was not set'))
        }
      })

      if (mdns.mdns == null) {
        reject(new Error('mdns property was not set'))
        return
      }

      mdns.mdns.on('response', () => {
        // query.gotResponse is async - we'll bail from that method when
        // comparing the senders PeerId to our own but it'll happen later
        // so allow enough time for the test to have failed if we emit
        // empty peerData objects
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

    await mdns.stop()
  })
})
