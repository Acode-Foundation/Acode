package com.silkimen.http;

import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.Charset;
import java.nio.charset.CharsetDecoder;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.MalformedInputException;

public class HttpBodyDecoder {
  private static final String[] ACCEPTED_CHARSETS = new String[] { "UTF-8", "ISO-8859-1" };

  public static String decodeBody(byte[] body, String charsetName)
      throws CharacterCodingException, MalformedInputException {

    return decodeBody(ByteBuffer.wrap(body), charsetName);
  }

  public static String decodeBody(ByteBuffer body, String charsetName)
      throws CharacterCodingException, MalformedInputException {

    if (charsetName == null) {
      return tryDecodeByteBuffer(body);
    } else {
      return decodeByteBuffer(body, charsetName);
    }
  }

  private static String tryDecodeByteBuffer(ByteBuffer buffer)
      throws CharacterCodingException, MalformedInputException {

    for (int i = 0; i < ACCEPTED_CHARSETS.length - 1; i++) {
      try {
        return decodeByteBuffer(buffer, ACCEPTED_CHARSETS[i]);
      } catch (MalformedInputException e) {
        continue;
      } catch (CharacterCodingException e) {
        continue;
      }
    }

    return decodeBody(buffer, ACCEPTED_CHARSETS[ACCEPTED_CHARSETS.length - 1]);
  }

  private static String decodeByteBuffer(ByteBuffer buffer, String charsetName)
      throws CharacterCodingException, MalformedInputException {

    return createCharsetDecoder(charsetName).decode(buffer).toString();
  }

  private static CharsetDecoder createCharsetDecoder(String charsetName) {
    return Charset.forName(charsetName).newDecoder().onMalformedInput(CodingErrorAction.REPORT)
        .onUnmappableCharacter(CodingErrorAction.REPORT);
  }
}
