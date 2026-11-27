#include <curl/curl.h>

CURLcode acode_curl_long(CURL *handle, CURLoption option, long value);
CURLcode acode_curl_string(CURL *handle, CURLoption option, const char *value);
CURLcode acode_curl_pointer(CURL *handle, CURLoption option, void *value);
CURLcode acode_curl_write(CURL *handle, CURLoption option, curl_write_callback callback);
CURLcode acode_curl_read(CURL *handle, curl_read_callback callback);
CURLcode acode_curl_progress(CURL *handle, curl_xferinfo_callback callback);
CURLcode acode_curl_offset(CURL *handle, CURLoption option, curl_off_t value);
long acode_curl_response(CURL *handle);
const char *acode_curl_directory(CURL *handle);
CURLcode acode_curl_debug(CURL *handle, curl_debug_callback callback);
CURLcode acode_curl_chunk(CURL *handle, curl_chunk_bgn_callback callback);
CURLcode acode_curl_ca(CURL *handle, const void *data, size_t length);
