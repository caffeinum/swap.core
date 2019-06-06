import SwapApp from 'swap.app'

class SwapInterface {

  constructor() {
    // service name, within it will be stored in this.app.swaps
    this._swapName = null
  }

  _initSwap(app) {
    // init service on SwapApp mounting
    SwapApp.required(app)

    this.accounts = app.services.auth.accounts
  }

  create(scriptValues) {

  }

  checkScript(scriptValues) {

  }

  withdraw(scriptValues) {

  }

  refund(scriptValues) {
    throw new Error(`Not implemented`)
  }
}


export default SwapInterface
