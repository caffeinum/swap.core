import SwapApp, { SwapInterface } from 'swap.app'
import { Bitcoin } from 'examples/react/src/instances/bitcoin'
import bitcoin from 'bitcoinjs-lib'
import Swap from 'swap.swap'
import { BTC2ETH, ETH2BTC } from 'swap.flows'
import { BtcSwap, EthSwap } from 'swap.swaps'

jest.mock('swap.app')
jest.unmock('swap.flows')
jest.unmock('swap.swaps')

const log = console.log
const crypto = {
  ripemd160: secret => 'c0933f9be51a284acb6b1a6617a48d795bdeaa80'
}

const secret      = 'c0809ce9f484fdcdfb2d5aabd609768ce0374ee97a1a5618ce4cd3f16c00a078'
const secretHash  = 'c0933f9be51a284acb6b1a6617a48d795bdeaa80'
const lockTime    = 1521171580

const btcOwner = {
  privateKey: 'cRkKzpir8GneA48iQVjSpUGT5mopFRTGDES7Kb43JduzrbhuVncn',
  publicKey: '02b65eed68f383178ee4bf301d1a2d231194eba2a65969187d49a6cdd945ea4f9d',
}
const ethOwner = {
  privateKey: 'cT5n9yx1xw3TcbvpEAuXvzhrTb5du4RAYbAbTqHfZ9nbq6gJQMGn',
  publicKey: '02dfae561eb061072da126f1aed7d47202a36b762e89e913c400cdb682360d9620',
}

const _ORDER = {
  'id': 'Qm-1231231',
  'buyCurrency': 'BTC',
  'sellCurrency': 'ETH',
  'buyAmount': '1',
  'sellAmount': '10',
  'exchangeRate': '0.1',

  'owner': { peer: 'Qmaaa' },
  'participant': { peer: 'Qmbbb' },

  'requests': [],
  'isRequested': true,
  'isProcessing': true,
}

beforeAll(() => {
  SwapApp.flows['BTC2ETH'] = BTC2ETH
  SwapApp.flows['ETH2BTC'] = ETH2BTC

  SwapApp.swaps['ETH'] = new EthSwap({
    fetchBalance: jest.fn(),
    address: '',
    abi: [],
  })

  SwapApp.swaps['BTC'] = new BtcSwap({
    fetchBalance: jest.fn(),
    fetchUnspents: jest.fn(),
    broadcastTx: jest.fn(),
  })
})

test('create swap', () => {
  const swap = new Swap("Qm-1231231", _ORDER)

  expect(swap.flow.state.step).toBe(0)
})

test('gets message sign swap', (done) => {
  const swap = new Swap("Qm-1231231", _ORDER)

  SwapApp.services.room.emit('swap sign')

  setTimeout(() => {
    expect(swap.flow.state.step).toBe(1)
    done()
  }, 500)
})

describe('full flow', () => {
  let swap
  beforeAll(() => {

  })
})
