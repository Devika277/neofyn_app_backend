const axios = require('axios');
const logger = require('../utils/logger');

const BASE_URL = 'http://gateway.vimopay.in';

class VidualGatewayProvider {
  async authorize(secretKey, saltKey, encryptDecryptKey, userId) {
    const response = await axios.post(
      `${BASE_URL}/pgapi/api/signature/authorizeuat`,
      {},
      {
        headers: {
          secretKey,
          saltKey,
          encryptdecryptKey: encryptDecryptKey,
          userId,
        },
      }
    );
    return response.data;
  }

  async initiatePayment(bearerToken, userId, encryptedRequestBody) {
    try {
      const response = await axios.post(
        `${BASE_URL}/pgapi/api/payment/paymentgatewayuat`,
        { requestBody: encryptedRequestBody },
        {
          headers: {
            Authorization: `Bearer ${bearerToken}`,
            userId,
          },
        }
      );
      return response.data;
    } catch (err) {
      logger.error('VidualGatewayProvider: paymentgatewayuat call failed', {
        status: err.response?.status,
        responseData: err.response?.data,
        requestBodyLength: encryptedRequestBody?.length,
      });
      throw err;
    }
  }
}

module.exports = VidualGatewayProvider;
