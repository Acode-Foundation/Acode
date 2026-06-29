module.exports = function init(global, console, messages) {
  var interface = {
    checkBlobApi: checkBlobApi,
    checkFileReaderApi: checkFileReaderApi,
    checkFormDataInstance: checkFormDataInstance,
    checkTextEncoderApi: checkTextEncoderApi,
    logWarnings: logWarnings,
  };

  return interface;

  function logWarnings() {
    if (!global.FormData) {
      console.warn(messages.MISSING_FORMDATA_API);
    } else if (!global.FormData.prototype || !global.FormData.prototype.entries) {
      console.warn(messages.MISSING_FORMDATA_ENTRIES_API);
    }
  }

  function checkBlobApi() {
    if (!global.Blob || !global.Blob.prototype) {
      throw new Error(messages.MISSING_BLOB_API);
    }
  }

  function checkFileReaderApi() {
    if (!global.FileReader || !global.FileReader.prototype) {
      throw new Error(messages.MISSING_FILE_READER_API);
    }
  }

  function checkFormDataInstance(instance) {
    if (!instance || !instance.entries) {
      throw new Error(messages.MISSING_FORMDATA_ENTRIES_API);
    }
  }

  function checkTextEncoderApi() {
    if (!global.TextEncoder || !global.TextEncoder.prototype) {
      throw new Error(messages.MISSING_TEXT_ENCODER_API);
    }
  }
};
