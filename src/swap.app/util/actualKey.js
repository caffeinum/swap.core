/**
 * @param {string} options.keyName
 */
const create = (keyName) => {
  const key = Date.now()

  sessionStorage.setItem(keyName, key)

  return key
}

/**
 * @param {string} options.keyName
 * @param {number} options.actualKey
 */
const compare = (keyName, actualKey) => {
  const oldKey = Number(sessionStorage.getItem(keyName))

  if (oldKey === 0) {
    throw new Error('Not found this keyName')
  }

  return oldKey === actualKey
}

/**
 * @param {string} options.keyName
 */
const remove = (keyName) => {
  sessionStorage.removeItem(keyName)
}

export default {
  create,
  compare,
  remove,
}
