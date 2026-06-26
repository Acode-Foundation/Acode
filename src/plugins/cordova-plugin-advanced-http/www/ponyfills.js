module.exports = function init(global) {
  var interface = { FormData: FormData };

  // expose all constructor functions for testing purposes
  if (init.debug) {
    interface.Iterator = Iterator;
  }
  
  function FormData() {
    this.__items = [];
  }

  FormData.prototype.append = function(name, value, filename) {
    if (global.File && value instanceof global.File) {
      // nothing to do
    } else if (global.Blob && value instanceof global.Blob) {
      // mimic File instance by adding missing properties
      value.lastModifiedDate = new Date();
      value.name = filename !== undefined ? filename : 'blob';
    } else {
      value = String(value);
    }

    this.__items.push([ name, value ]);
  };

  FormData.prototype.entries = function() {
    return new Iterator(this.__items);
  };

  function Iterator(items) {
    this.__items = items;
    this.__position = -1;
  }

  Iterator.prototype.next = function() {
    this.__position += 1;

    if (this.__position < this.__items.length) {
      return { done: false, value: this.__items[this.__position] };
    }

    return { done: true, value: undefined };
  }

  return interface;
};
