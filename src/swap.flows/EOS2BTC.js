/* eslint-disable no-await-in-loop */
import debug from 'debug'
import SwapApp, { constants } from 'swap.app'
import { Flow } from 'swap.swap'

import { BTCTransactionHandlers } from 'swap.swaps/BtcSwap'
import { EOSTransactionHandlers } from 'swap.swaps/EosSwap'

export class BTC2EOS extends Flow {
  _getStates() {
    return {
      ...this.btcSwap.getCreateSwapStates(),
      ...this.eosSwap.checkCreateSwapStates(),
      ...this.eosSwap.getWithdrawSwapStates(),
    }
  }
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

const transactionHandlers = (flow) => ({
  openSwap: () => {
    const { secretHash } = flow.state
    const { sellAmount: amount, participant } = flow.swap

    return flow.eosSwap.open({
      btcOwner: participant.eos.address,
      secretHash,
      amount,
    })
  },
  btcWithdraw: async () => {
    const { secret, scriptValues } = flow.state

    let btcWithdrawTx = null
    while (!btcWithdrawTx) {
      debug('swap.core:flow')('try withdraw btc...')
      try {
        btcWithdrawTx = await flow.btcSwap.withdraw({ scriptValues, secret }, null, null, 'sha256')
      } catch (err) {
        console.error(err)
        await sleep(5000)
      }
    }

    return btcWithdrawTx.txid
  },
  refund: () => {
    const { participant: { eos: { address } } } = flow.swap

    return flow.eosSwap.refund({
      btcOwner: address,
    })
  },
})

const pullHandlers = (flow) => ({
  btcScript: () => new Promise(resolve => {
    flow.swap.room.once(flow.actions.createBtcScript, resolve)
    flow.swap.room.sendMessage({
      event: `request ${flow.actions.createBtcScript}`,
    })
  }),
  verifyScript: async () => {
    const { buyAmount: value } = flow.swap
    const { scriptValues } = flow.state
    const recipientPublicKey = SwapApp.services.auth.accounts.btc.getPublicKey()

    const eosLockPeriod = flow.eosSwap.getLockPeriod()
    const now = Math.floor(Date.now() / 1000)
    const lockTime = now + eosLockPeriod

    let errorMessage = true
    while (errorMessage) {
      debug('swap.core:flow')('try verify script...')
      errorMessage = await flow.btcSwap.checkScript(scriptValues, {
        value,
        recipientPublicKey,
        lockTime,
      }, 'sha256')

      if (errorMessage) {
        console.error(errorMessage)
        await sleep(5000)
      }
    }
  },
  revealedSecret: async () => {

    let secret = null
    while (!secret) {
      debug('swap.core:flow')('try fetch secret...')
      secret = await flow.eosSwap.fetchSecret({ eosOwner, btcOwner })
      if (!secret) {
        await sleep(5000)
      }
    }

    return secret
  },
  eosWithdrawTx: () => new Promise(resolve => {

  }),
})

const pushHandlers = (flow) => ({
  openSwap() {
    const { openTx, swapID } = flow.state

    flow.swap.room.sendMessage({
      event: flow.actions.openSwap,
      data: {
        openTx, swapID,
      },
    })
  },
  btcWithdraw() {
    const { btcWithdrawTx } = flow.state

    flow.swap.room.sendMessage({
      event: flow.actions.btcWithdraw,
      data: {
        btcWithdrawTx,
      },
    })
  },
})

class EOS2BTC extends Flow {
  static getName() {
    return `${this.getFromName()}2${this.getToName()}`
  }
  static getFromName() {
    return constants.COINS.eos
  }
  static getToName() {
    return constants.COINS.btc
  }
  constructor(swap) {
    super(swap)

    this._flowName = EOS2BTC.getName()

    this.eosSwap = SwapApp.swaps[constants.COINS.eos]
    this.btcSwap = SwapApp.swaps[constants.COINS.btc]

    this.state = {
      ...this.state,
      ...{
        swapID: null,

        secret: null,
        secretHash: null,

        scriptValues: null,

        createTx: null,
        openTx: null,
        eosWithdrawTx: null,
        btcWithdrawTx: null,

        eosRefundTx: null,
        btcRefundTx: null,
      },
    }

    this.actions = {
      submitSecret: 'submit secret',
      createBtcScript: 'create btc script',
      verifyScript: 'verify script',
      openSwap: 'open swap',
      eosWithdraw: 'eos withdraw',
      btcWithdraw: 'btc withdraw',
    }

    this.transact = transactionHandlers(this)
    this.pull = pullHandlers(this)
    this.push = pushHandlers(this)

    this.listenRequests()

    super._persistSteps()
    super._persistState()
  }

  _getSteps() {
    const flow = this

    const { owner: eosOwnerData, participant: btcOwnerData } = flow.swap
    const eosOwner = eosOwnerData.eos.address
    const btcOwner = btcOwnerData.eos.address

    return [
      () => {
        if (flow.pull.swapExists()) {
          await flow.pull.refundCompleted()
        }

        flow.finishStep({ isSwapExist: false })
      },
      async () => {
        const { scriptValues, createTx } = await flow.pull.btcScript()
        const { secretHash } = scriptValues

        flow.finishStep({ scriptValues, secretHash, createTx })
      },
      async () => {
        await flow.pull.verifyScript()

        flow.finishStep()
      },
      async () => {
        const { secretHash } = flow.state
        const { sellAmount: amount, participant } = flow.swap

        const { openTx, swapID } = await flow.eosSwap.open({
          btcOwner,
          secretHash,
          amount,
        })

        flow.finishStep({ openTx, swapID })
        flow.push.openSwap()
      },
      async () => {
        flow.swap.room.once(flow.actions.eosWithdraw, ({ eosWithdrawTx, secret }) => {
          flow.setState({ eosWithdrawTx })
        })

        flow.swap.room.sendMessage({
          event: `request ${flow.actions.eosWithdrawTx}`,
        })

        const { secret } = await flow.pull.fetchSecret()

        flow.finishStep({ secret })
      },
      () => {
        flow.transact.btcWithdraw().then((btcWithdrawTx) => {
          flow.finishStep({ btcWithdrawTx })
          flow.push.btcWithdraw()
        })
      },
    ]
  }

  tryRefund() {
    const flow = this

    return flow.transact.refund().then((eosRefundTx) => {
      flow.setState({ eosRefundTx })
    })
  }

  listenRequests() {
    const flow = this

    flow.swap.room.on(`request ${flow.actions.openSwap}`, () => {
      if (flow.state.openTx && flow.state.swapID) {
        flow.push.openSwap()
      }
    })

    flow.swap.room.on(`request ${flow.actions.btcWithdraw}`, () => {
      if (flow.state.btcWithdrawTx) {
        flow.push.btcWithdraw()
      }
    })
  }
}

export default EOS2BTC
