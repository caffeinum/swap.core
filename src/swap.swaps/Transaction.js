import debug from 'debug'
import SwapApp, { SwapInterface, constants } from 'swap.app'
import BigNumber from 'bignumber.js'


const Transaction = (hash) => {
  if (!hash || !hash.length) throw new Error(`Cant init tx without hash`)

  return {
    hash,

    block: '',
    blockNumber: 0,
    isMined: false,

    fetch: async function (fetchTxInfo) {
      return fetchTxInfo(`https://api.blockcypher.com/v1/btc/main/txs/${this.hash}`)
        .then((txinfo) => {

        })
    }
  }
}
