import debug from 'debug'
import SwapApp, { SwapInterface, constants } from 'swap.app'
import BigNumber from 'bignumber.js'

class BtcSwap extends SwapInterface {

  /**
   *
   * @param options
   * @param options.fetchBalance
   * @param options.fetchUnspents
   * @param options.broadcastTx
   * @param options.fetchTxInfo {(tx_hash) => Promise({ confidence, fees })}
   * @param options.estimateFeeRate { ({ speed }) => Promise(fee_rate_per_kb) }
   */
  constructor(options) {
    super()

    if (typeof options.fetchBalance !== 'function') {
      throw new Error('BtcSwap: "fetchBalance" required')
    }
    if (typeof options.fetchUnspents !== 'function') {
      throw new Error('BtcSwap: "fetchUnspents" required')
    }
    if (typeof options.broadcastTx !== 'function') {
      throw new Error('BtcSwap: "broadcastTx" required')
    }
    if (typeof options.fetchTxInfo !== 'function') {
      // tx_hash => { confidence, fees }
      console.warn(`BtcSwap: "fetchTxInfo" is not a function. You will not be able to use tx-confidence feature`)
    }
    if (typeof options.estimateFeeRate !== 'function') {
      // ({ speed } = {}) => feeRate
      console.warn(`BtcSwap: "estimateFeeRate" is not a function. You will not be able use automatic mempool-based fee`)
    }

    this._swapName      = constants.COINS.btc
    this.fetchBalance   = options.fetchBalance
    this.fetchUnspents  = options.fetchUnspents
    this.broadcastTx    = options.broadcastTx
    this.feeValue       = options.feeValue || 5000
    this.fetchTxInfo    = options.fetchTxInfo || (() => ({}))
    this.estimateFeeRate= options.estimateFeeRate || (() => {})
  }

  _initSwap() {
    this.network = (
      SwapApp.isMainNet()
        ? SwapApp.env.bitcoin.networks.bitcoin
        : SwapApp.env.bitcoin.networks.testnet
    )
  }

  /**
   *
   * @param {object} options
   * @param {boolean} options.inSatoshis
   * @param {Number} options.size
   * @param {String} options.speed
   * @returns {BigNumber|Number}
   * @public
   */
  async getTxFee({ inSatoshis, size = 550, speed = 'normal' } = {}) {
    try {
      const estimatedRate = await this.estimateFeeRate({ speed })
      const estimatedFee = Math.ceil(estimatedRate * size / 1024)

      if (Number.isInteger(Number(estimatedFee))) {
        this.feeValue = Number(estimatedFee)
      } else {
        throw new Error(`Not an Integer: ${estimatedFee}`)
      }
    } catch (err) {
      debug('swap.core:swaps')(`BtcSwap: Error with fee update: ${err.message}, using old value feeValue=${this.feeValue}`)
    }

    return inSatoshis
      ? this.feeValue
      : BigNumber(this.feeValue).div(1e8)
  }

  /**
   *
   * @param {array} unspents
   * @param {Number} expectedConfidenceLevel
   * @returns {array}
   * @private
   */
  async filterConfidentUnspents(unspents, expectedConfidenceLevel) {
    const currentFastestFee = await this.getTxFee({ inSatoshis: true })

    const feesToConfidence = (fees, size) =>
      fees < currentFastestFee ? (fees / currentFastestFee) : 1

    const confirmationsToConfidence = confs => confs > 0 ? 1 : 0

    const fetchConfidence = async ({ txid, confirmations }) => {
      try {
        const { confidence, fees, size } = await this.fetchTxInfo(txid)

        if (confidence) {
          return confidence
        }

        if (fees) {
          return feesToConfidence(fees, size)
        }

        throw new Error(`confidence=${confidence},fees=${fees}`)

      } catch (err) {
        console.error(`BtcSwap: Error fetching confidence: using confirmations > 0`, err.message)
        return confirmationsToConfidence(confirmations)
      }
    }

    const confidences = Promise.all(unspents.map(fetchConfidence))

    return unspents.filter(async (utxo, index) => {
      return confidences[index] > expectedConfidenceLevel
    })
  }
  /**
   *
   * @param {object} data
   * @param {object} data.script
   * @param {*} data.txRaw
   * @param {string} data.secret
   * @private
   */
  _signTransaction(data) {
    const { script, txRaw, secret } = data

    const hashType      = SwapApp.env.bitcoin.Transaction.SIGHASH_ALL
    const signatureHash = txRaw.hashForSignature(0, script, hashType)
    const signature     = SwapApp.services.auth.accounts.btc.sign(signatureHash).toScriptSignature(hashType)

    const scriptSig = SwapApp.env.bitcoin.script.scriptHash.input.encode(
      [
        signature,
        SwapApp.services.auth.accounts.btc.getPublicKeyBuffer(),
        Buffer.from(secret.replace(/^0x/, ''), 'hex'),
      ],
      script,
    )

    txRaw.setInputScript(0, scriptSig)
  }

  /**
   *
   * @param {object} data
   * @param {string} data.secretHash
   * @param {string} data.ownerPublicKey
   * @param {string} data.recipientPublicKey
   * @param {number} data.lockTime
   * @returns {{scriptAddress: *, script: (*|{ignored})}}
   */
  createScript(data, hashName = 'ripemd160') {
    const hashOpcodeName = `OP_${hashName.toUpperCase()}`
    const hashOpcode = SwapApp.env.bitcoin.opcodes[hashOpcodeName]

    const { secretHash, ownerPublicKey, recipientPublicKey, lockTime } = data

    debug('swap.core:swaps')('DATA', data)

    const script = SwapApp.env.bitcoin.script.compile([

      hashOpcode,
      Buffer.from(secretHash, 'hex'),
      SwapApp.env.bitcoin.opcodes.OP_EQUALVERIFY,

      Buffer.from(recipientPublicKey, 'hex'),
      SwapApp.env.bitcoin.opcodes.OP_EQUAL,
      SwapApp.env.bitcoin.opcodes.OP_IF,

      Buffer.from(recipientPublicKey, 'hex'),
      SwapApp.env.bitcoin.opcodes.OP_CHECKSIG,

      SwapApp.env.bitcoin.opcodes.OP_ELSE,

      SwapApp.env.bitcoin.script.number.encode(lockTime),
      SwapApp.env.bitcoin.opcodes.OP_CHECKLOCKTIMEVERIFY,
      SwapApp.env.bitcoin.opcodes.OP_DROP,
      Buffer.from(ownerPublicKey, 'hex'),
      SwapApp.env.bitcoin.opcodes.OP_CHECKSIG,

      SwapApp.env.bitcoin.opcodes.OP_ENDIF,
    ])

    const scriptPubKey  = SwapApp.env.bitcoin.script.scriptHash.output.encode(SwapApp.env.bitcoin.crypto.hash160(script))
    const scriptAddress = SwapApp.env.bitcoin.address.fromOutputScript(scriptPubKey, this.network)

    return {
      scriptAddress,
      script,
    }
  }

  /**
   *
   * @param {object} data
   * @param {string} data.recipientPublicKey
   * @param {number} data.lockTime
   * @param {object} expected
   * @param {number} expected.value
   * @param {number} expected.lockTime
   * @param {string} expected.recipientPublicKey
   * @returns {Promise.<string>}
   */
  async checkScript(data, expected, hashName) {
    const { recipientPublicKey, lockTime } = data
    const { scriptAddress, script } = this.createScript(data, hashName)

    const expectedConfidence = expected.confidence
    const unspents      = await this.fetchUnspents(scriptAddress)
    const expectedValue = expected.value.multipliedBy(1e8).integerValue()
    const totalUnspent  = unspents.reduce((summ, { satoshis }) => summ + satoshis, 0)

    const confidentUnspents = await this.filterConfidentUnspents(unspents, expectedConfidence)
    const totalConfidentUnspent = confidentUnspents.reduce((summ, { satoshis }) => summ + satoshis, 0)

    if (expectedValue.isGreaterThan(totalUnspent)) {
      return `Expected script value: ${expectedValue.toNumber()}, got: ${totalUnspent}`
    }
    if (expected.lockTime > lockTime) {
      return `Expected script lockTime: ${expected.lockTime}, got: ${lockTime}`
    }
    if (expected.recipientPublicKey !== recipientPublicKey) {
      return `Expected script recipient publicKey: ${expected.recipientPublicKey}, got: ${recipientPublicKey}`
    }
    if (expectedValue.isGreaterThan(totalConfidentUnspent)) {
      return `Expected script value: ${expectedValue.toNumber()} with confidence above ${expectedConfidence}, got: ${totalConfidentUnspent}`
    }
  }

  /**
   *
   * @param {object} data
   * @param {object} data.scriptValues
   * @param {BigNumber} data.amount
   * @param {function} handleTransactionHash
   * @param {string} hashName
   * @returns {Promise}
   */
  fundScript(data, handleTransactionHash, hashName) {
    const { scriptValues, amount } = data

    return new Promise(async (resolve, reject) => {
      try {
        const { scriptAddress } = this.createScript(scriptValues, hashName)

        const tx            = new SwapApp.env.bitcoin.TransactionBuilder(this.network)
        const unspents      = await this.fetchUnspents(SwapApp.services.auth.accounts.btc.getAddress())

        const fundValue     = amount.multipliedBy(1e8).integerValue().toNumber()
        const feeValue      = await this.getTxFee({ inSatoshis: true })
        const totalUnspent  = unspents.reduce((summ, { satoshis }) => summ + satoshis, 0)
        const skipValue     = totalUnspent - fundValue - feeValue

        if (totalUnspent < feeValue + fundValue) {
          throw new Error(`Total less than fee: ${totalUnspent} < ${feeValue} + ${fundValue}`)
        }

        unspents.forEach(({ txid, vout }) => tx.addInput(txid, vout))
        tx.addOutput(scriptAddress, fundValue)
        tx.addOutput(SwapApp.services.auth.accounts.btc.getAddress(), skipValue)
        tx.inputs.forEach((input, index) => {
          tx.sign(index, SwapApp.services.auth.accounts.btc)
        })

        const txRaw = tx.buildIncomplete()

        if (typeof handleTransactionHash === 'function') {
          handleTransactionHash(txRaw.getId())
        }

        try {
          const result = await this.broadcastTx(txRaw.toHex())

          resolve(result)
        }
        catch (err) {
          reject(err)
        }
      }
      catch (err) {
        reject(err)
      }
    })
  }

  /**
   *
   * @param {object|string} data - scriptValues or wallet address
   * @returns {Promise.<void>}
   */
  async getBalance(data, hashName) {
    let address

    if (typeof data === 'string') {
      address = data
    }
    else if (typeof data === 'object') {
      const { scriptAddress } = this.createScript(data, hashName)

      address = scriptAddress
    }
    else {
      throw new Error('Wrong data type')
    }

    const unspents      = await this.fetchUnspents(address)
    const totalUnspent  = unspents && unspents.length && unspents.reduce((summ, { satoshis }) => summ + satoshis, 0) || 0

    return totalUnspent
  }

  /**
   *
   * @param {object} data
   * @param {object} data.scriptValues
   * @param {string} data.secret
   * @param {boolean} isRefund
   * @returns {Promise}
   */
  async getWithdrawRawTransaction(data, isRefund, hashName) {
    const { scriptValues, secret } = data

    const { script, scriptAddress } = this.createScript(scriptValues, hashName)

     const { destinationAddress } = data

    const tx            = new SwapApp.env.bitcoin.TransactionBuilder(this.network)
    const unspents      = await this.fetchUnspents(scriptAddress)
    const feeValue      = this.feeValue // TODO how to get this value
    const totalUnspent  = unspents.reduce((summ, { satoshis }) => summ + satoshis, 0)

    if (totalUnspent < feeValue) {
      throw new Error(`Total less than fee: ${totalUnspent} < ${feeValue}`)
    }

    if (isRefund) {
      tx.setLockTime(scriptValues.lockTime)
    }

    unspents.forEach(({ txid, vout }) => tx.addInput(txid, vout, 0xfffffffe))
    tx.addOutput((destinationAddress) ? destinationAddress : SwapApp.services.auth.accounts.btc.getAddress(), totalUnspent - feeValue)

    const txRaw = tx.buildIncomplete()

    this._signTransaction({
      script,
      secret,
      txRaw,
    })

    return txRaw
  }

  /**
   *
   * @param {object} data
   * @param {object} data.scriptValues
   * @param {string} data.secret
   * @param {boolean} isRefund
   * @returns {Promise}
   */
  async getWithdrawHexTransaction(data, isRefund) {
    const txRaw = await this.getWithdrawRawTransaction(data, isRefund)

    return txRaw.toHex()
  }

  /**
   *
   * @param {object} data
   * @param {object} data.scriptValues
   * @param {string} data.secret
   * @returns {Promise}
   */
  getRefundRawTransaction(data) {
    return this.getWithdrawRawTransaction(data, true)
  }

  /**
   *
   * @param {object} data
   * @param {object} data.scriptValues
   * @param {string} data.secret
   * @returns {Promise}
   */
  async getRefundHexTransaction(data) {
    const txRaw = await this.getRefundRawTransaction(data)

    return txRaw.toHex()
  }

  /**
   *
   * @param {object} data
   * @param {object} data.scriptValues
   * @param {string} data.secret
   * @param {function} handleTransactionHash
   * @param {boolean} isRefund
   * @param {string} hashName
   * @returns {Promise}
   */
  withdraw(data, handleTransactionHash, isRefund, hashName) {
    return new Promise(async (resolve, reject) => {
      try {
        const txRaw = await this.getWithdrawRawTransaction(data, isRefund, hashName)
        debug('swap.core:swaps')('raw tx withdraw', txRaw.toHex())

        if (typeof handleTransactionHash === 'function') {
          handleTransactionHash(txRaw.getId())
        }

        const result = await this.broadcastTx(txRaw.toHex())

        resolve(result)
      }
      catch (err) {
        reject(err)
      }
    })
  }

  /**
   *
   * @param {object} data
   * @param {object} data.scriptValues
   * @param {string} data.secret
   * @param {function} handleTransactionHash
   * @param {string} hashName
   * @returns {Promise}
   */
  refund(data, handleTransactionHash, hashName) {
    return this.withdraw(data, handleTransactionHash, true, hashName)
  }
}


export default BtcSwap
