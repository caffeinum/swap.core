import crypto from 'bitcoinjs-lib/src/crypto' // move to BtcSwap
import SwapApp, { constants } from 'swap.app'
import { Flow } from 'swap.swap'


class BaseFlow extends Flow {
  static getName() {
    return `${constants.COINS.eth}2${constants.COINS.btc}`
  }

  constructor(swap) {
    super(swap)

    const main = swap.buyCurrency
    const base = swap.sellCurrency

    this.secondarySwap  = SwapApp.swaps[constants.COINS[main]]
    this.baseSwap       = SwapApp.swaps[constants.COINS[base]]

    this.stepNumbers = {
      'setup': 1,
      'sync-balance': 2,
      'lock-base': 3,
      'lock-secondary': 4,
      'withdraw-secondary': 5,
      'withdraw-base': 6,
      'finish': 7,
    }

    this.constraints = {
      'setup':              ['isMeSigned', 'isParticipantSigned'],
      'sync-balance':       ['isBalanceEnough',       'myBalance'],
      'lock-base':          ['isBaseLocked',          'scriptValues', 'secret', 'secretHash', 'baseLockedBalance', 'baseLockTxHash'],
      'lock-secondary':     ['isSecondaryLocked',     'secondaryLockedBalance', 'secondaryLockTxHash'],
      'withdraw-secondary': ['isSecondaryWithdrawn',  'secondaryWithdrawTxHash'],
      'withdraw-base':      ['isBaseWithdrawn',       'baseWithdrawTxHash'],
      'finish':             ['isSecondaryWithdrawn', 'isBaseWithdrawn'],
    }

    this.state = {
      step: 0,

      isMeSigned: null,
      isParticipantSigned: null,

      isBalanceEnough: null,

      isBaseLocked: null,
      isSecondaryLocked: null,

      isSecondaryWithdrawn: null,
      isBaseWithdrawn: null,

      isFinished: null,


      myBalance: null,

      scriptValues: null,
      secret: null,
      secretHash: null,

      baseLockTxHash: null,
      baseLockedBalance: null,

      secondaryLockTxHash: null,
      secondaryLockedBalance: null,

      secondaryWithdrawTxHash: null,
      baseWithdrawTxHash: null,
    }

    super._persistSteps()
    this._persistState()
  }

  _persistState() {
    super._persistState()
  }

  _getSteps() {
    const flow = this

    return [

      // 1. Sign swap to start

      () => {
        flow.swap.room.once('sign', () => {
          this.setState({
            isParticipantSigned: true
          })
        })

        flow.swap.room.once('request sign', () => {
          flow.swap.room.sendMessage('sign')

          this.setState({
            isMeSigned: true
          })
        })

        flow.swap.room.sendMessage('request sign')

        flow.swap.room.sendMessage('sign')

        this.setState({
          isMeSigned: true
        })

        // this.setup()
      },

      // 2. Wait participant create, fund BTC Script

      () => {

      },
    ]
  }
}
