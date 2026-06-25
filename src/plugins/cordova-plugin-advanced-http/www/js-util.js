module.exports = {
  // typeof is not working reliably in JS
  getTypeOf: function (object) {
    switch (Object.prototype.toString.call(object)) {
      case '[object Array]':
        return 'Array';
      case '[object Blob]':
        return 'Blob';
      case '[object Uint8Array]':
        return 'Uint8Array';
      case '[object ArrayBuffer]':
        return 'ArrayBuffer';
      case '[object Boolean]':
        return 'Boolean';
      case '[object Function]':
        return 'Function';
      case '[object Null]':
        return 'Null';
      case '[object Number]':
        return 'Number';
      case '[object Object]':
        return 'Object';
      case '[object String]':
        return 'String';
      case '[object Undefined]':
        return 'Undefined';
      default:
        return 'Unknown';
    }
  }
}

