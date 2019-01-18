import crypto from 'bitcoinjs-lib/src/crypto'
import SwapApp, { constants } from 'swap.app'
import { Flow } from 'swap.swap'

class BTCTransactionHandlers {
  createBtcScript() {
    return new Promise(async (resolve, reject) => {
      try {
        await flow.btcSwap.fundScript({
          scriptValues,
          amount,
        }, (createTx) => {
          resolve({ createTx, scriptValues })
        }, 'sha256')
      } catch (err) {
        console.error(`funding tx failed: ${err.message}`)
      }
    })
  }
}

class EOSTransactionHandlers {
  eosWithdraw () {
    const { secret } = flow.state
    const { participant: eosOwner } = flow.swap

    return flow.eosSwap.withdraw({
      eosOwner: eosOwner.eos.address,
      secret,
    })
  },
}

const transactionHandlers = (flow) => ({
  createBtcScript: () => {
    const { sellAmount: amount, participant: eosOwner } = flow.swap

    const getLockTime = () => {
      const eosLockTime = flow.eosSwap.getLockPeriod()
      const btcLockTime = eosLockTime * 2
      const nowTime = Math.floor(Date.now() / 1000)

      return nowTime + btcLockTime
    }

    const lockTime = getLockTime()
    //
    // const scriptValues = {
    //   secretHash: flow.state.secretHash,
    //   ownerPublicKey: SwapApp.services.auth.accounts.btc.getPublicKey(),
    //   recipientPublicKey: eosOwner.btc.publicKey,
    //   lockTime,
    // }

    const { scriptAddress, scriptValues } = flow.swap.btcSwap.createScript({
      secret: flow.state.secret,
      owner: SwapApp.services.auth.accounts.btc,
      participant: eosOwner,
    })

    console.log('scriptAddress', scriptAddress)

    return new Promise(async (resolve, reject) => {
      try {
        await flow.btcSwap.fundScript({
          scriptValues,
          amount,
        }, (createTx) => {
          resolve({ createTx, scriptValues })
        }, 'sha256')
      } catch (err) {
        console.error(`funding tx failed: ${err.message}`)
      }
    })
  },
  eosWithdraw: () => {
    const { secret } = flow.state
    const { participant: eosOwner } = flow.swap

    return flow.eosSwap.withdraw({
      eosOwner: eosOwner.eos.address,
      secret,
    })
  },
  refund: () => {
    const { secret, scriptValues } = flow.state

    return new Promise(async (resolve, reject) => {
      try {
        await flow.btcSwap.refund({
          scriptValues,
          secret,
        }, (btcRefundTx) => {
          resolve(btcRefundTx)
        }, 'sha256')
      } catch (err) {
        console.error(`refund failed: ${err.message}`)
      }
    })
  },
})

const pullHandlers = (flow) => ({
  submitSecret: () => new Promise(resolve => {
    flow.swap.events.once(flow.actions.submitSecret, resolve)
  }),
  openSwap: () => new Promise(resolve => {
    flow.swap.room.once(flow.actions.openSwap, resolve)
    flow.swap.room.sendMessage({
      event: `request ${flow.actions.openSwap}`,
    })
  }),
  btcWithdraw: () => new Promise(resolve => {
    flow.swap.room.once(flow.actions.btcWithdraw, resolve)
    flow.swap.room.sendMessage({
      event: `request ${flow.actions.btcWithdraw}`,
    })
  }),
})

const messages = state => ({
  createBtcScript: (state) => {
    const { scriptValues, createTx } = state

    return {
      event: ACTIONS.createBtcScript,
      data: {
        scriptValues, createTx,
      },
    }
  },
  eosWithdraw: (state) => {
    const { eosWithdrawTx, secret } = state

    return ({
      event: ACTIONS.eosWithdraw,
      data: {
        eosWithdrawTx, secret,
      },
    })
  },
})

class BTC2EOS extends Flow {
  static getName() {
    return `${this.getFromName()}2${this.getToName()}`
  }
  static getFromName() {
    return constants.COINS.btc
  }
  static getToName() {
    return constants.COINS.eos
  }
  constructor(swap) {
    super(swap)

    this._flowName = BTC2EOS.getName()

    this.btcSwap = SwapApp.swaps[constants.COINS.btc]
    this.eosSwap = SwapApp.swaps[constants.COINS.eos]

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

    this.transact = this.transact()
    this.pull = pullHandlers(this)
    this.buildMessage = messages(this.state)

    this.listenRequests()

    super._persistSteps()
    super._persistState()
  }

  _getSteps() {
    const flow = this

    return [
      () => {
        flow.pull.submitSecret().then(({ secret, secretHash }) => {
          this.finishStep({ secret, secretHash })
        })
      },
      () => {
        flow.transact.createBtcScript().then(({ scriptValues, createTx }) => {
          flow.finishStep({ scriptValues, createTx })
          flow.push.createBtcScript()
        })
      },
      () => {
        flow.pull.openSwap().then(({ openTx, swapID }) => {
          flow.finishStep({ openTx, swapID })
        })
      },
      () => {
        flow.transact.eosWithdraw().then((eosWithdrawTx) => {
          flow.finishStep({ eosWithdrawTx })

          flow.room.sendMessage(this.message.eosWithdraw())

          flow.push.eosWithdraw()
        })
      },
      () => {
        flow.pull.btcWithdraw().then(({ btcWithdrawTx }) => {
          flow.finishStep({ btcWithdrawTx })
        })
      },
    ]
  }

  tryWithdraw({ secret }) {

  }

  tryRefund() {
    const flow = this

    return flow.transact.refund().then((btcRefundTx) => {
      flow.setState({ btcRefundTx })
    })
  }

  listenRequests() {
    const flow = this

    flow.swap.room.on(`request ${flow.actions.createBtcScript}`, () => {
      if (flow.state.scriptValues && flow.state.createTx) {
        flow.push.createBtcScript()
      }
    })

    flow.swap.room.on(`request ${flow.actions.eosWithdraw}`, () => {
      if (flow.state.eosWithdrawTx && flow.state.secret) {
        flow.push.eosWithdraw()
      }
    })
  }
}

export default BTC2EOS
