#include "AcodeCurl.h"

CURLcode acode_curl_long(CURL *handle, CURLoption option, long value) {
    return curl_easy_setopt(handle, option, value);
}
CURLcode acode_curl_string(CURL *handle, CURLoption option, const char *value) {
    return curl_easy_setopt(handle, option, value);
}
CURLcode acode_curl_pointer(CURL *handle, CURLoption option, void *value) {
    return curl_easy_setopt(handle, option, value);
}
CURLcode acode_curl_write(CURL *handle, CURLoption option, curl_write_callback callback) {
    return curl_easy_setopt(handle, option, callback);
}
CURLcode acode_curl_read(CURL *handle, curl_read_callback callback) {
    return curl_easy_setopt(handle, CURLOPT_READFUNCTION, callback);
}
CURLcode acode_curl_progress(CURL *handle, curl_xferinfo_callback callback) {
    return curl_easy_setopt(handle, CURLOPT_XFERINFOFUNCTION, callback);
}
CURLcode acode_curl_offset(CURL *handle, CURLoption option, curl_off_t value) {
    return curl_easy_setopt(handle, option, value);
}
long acode_curl_response(CURL *handle) {
    long code = 0;
    curl_easy_getinfo(handle, CURLINFO_RESPONSE_CODE, &code);
    return code;
}
const char *acode_curl_directory(CURL *handle) {
    char *directory = NULL;
    curl_easy_getinfo(handle, CURLINFO_FTP_ENTRY_PATH, &directory);
    return directory;
}
CURLcode acode_curl_debug(CURL *handle, curl_debug_callback callback) {
    return curl_easy_setopt(handle, CURLOPT_DEBUGFUNCTION, callback);
}
CURLcode acode_curl_chunk(CURL *handle, curl_chunk_bgn_callback callback) {
    return curl_easy_setopt(handle, CURLOPT_CHUNK_BGN_FUNCTION, callback);
}
CURLcode acode_curl_ca(CURL *handle, const void *data, size_t length) {
    struct curl_blob blob = {(void *)data, length, CURL_BLOB_COPY};
    return curl_easy_setopt(handle, CURLOPT_CAINFO_BLOB, &blob);
}
