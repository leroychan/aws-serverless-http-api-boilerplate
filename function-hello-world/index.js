// Initialize Libraries
const { performance, PerformanceObserver } = require('perf_hooks');
const AWSXRay = require('aws-xray-sdk');
const AWS = AWSXRay.captureAWS(require('aws-sdk'));
const docClient = new AWS.DynamoDB.DocumentClient({ apiVersion: '2012-08-10' });
const uuid = require('uuid');
AWSXRay.captureHTTPsGlobal(require('https'));
const https = require('https');
const request = require('request-promise-native');
const logger = require('@utils/logger');
const lambdaHelper = require('@utils/lambda');
const dynamodbHelper = require('@utils/dynamodb');
const apigw = require('@utils/apigw');
const emf = require('@utils/emf');

// Environment Variable(s)
const environment = process.env.ENVIRONMENT;
const tableName = process.env.TABLE_NAME;
const applicationName = process.env.APPLICATION_NAME || 'HelloWorldApi';

// Global Variable(s)
const functionName = 'helloworld';

// Main
exports.handler = async (event, context) => {
  const correlationId = uuid.v4();
  let contextualInformation;
  try {
    // Initialize Variables
    const httpMethod = event.requestContext.http.method;
    const resource = event.rawPath;
    const routeKey = event.routeKey;

    contextualInformation = lambdaHelper.formatApiGwContextualInformation(
      correlationId,
      event,
      context,
    );

    // Initialize Performance Time using Native Perf Hooks
    const obs = new PerformanceObserver((list, observer) => {
      for (const entry of list.getEntries()) {
        emf.publishMetricLatency(functionName, entry.name, entry.duration);
      }
      logger.info(
        list.getEntries(),
        lambdaHelper.formatLog(`${functionName}:index`, 'performance', contextualInformation),
      );
      observer.disconnect();
    });
    obs.observe({ entryTypes: ['measure'], buffered: true });
    performance.mark('handler:initialize');

    // Log Initial Request
    logger.info(
      event.body,
      lambdaHelper.formatLog(`${functionName}:index`, 'request:received', contextualInformation),
    );

    // Catch all function for all API paths that are not valid
    if (!resource.startsWith('/helloworld')) {
      logger.warn(
        'Invalid Endpoint',
        lambdaHelper.formatLog(
          `${functionName}:index`,
          'request:failed:logic',
          contextualInformation,
        ),
      );
      measureFunctionPerformance('handler:failure:logic', performance);
      return apigw.formulateApiResponseForbidden(
        { errorMessage: 'Invalid Endpoint' },
        contextualInformation,
      );
    }

    // Main Processing Logic
    if (resource === '/helloworld' && httpMethod === 'POST') {
      const payload = JSON.parse(event.body);
      const insertResult = await dynamodbHelper.createOrUpdateRecord(
        tableName,
        payload,
        contextualInformation,
        performance,
      );
      if (insertResult.stack) {
        measureFunctionPerformance('handler:failure:logic', performance);
        return apigw.formulateApiResponseBadRequest(
          { errorMessage: 'Bad Request' },
          contextualInformation,
        );
      }
      measureFunctionPerformance('handler:completed:success', performance);
      return apigw.formulateApiResponseCreated(insertResult, contextualInformation);
    } else if (resource === '/helloworld' && httpMethod === 'GET') {
      const getAllResult = await dynamodbHelper.getRecords(
        tableName,
        contextualInformation,
        performance,
      );
      if (getAllResult.stack) {
        measureFunctionPerformance('handler:failure:logic', performance);
        return apigw.formulateApiResponseBadRequest(
          { errorMessage: 'Bad Request' },
          contextualInformation,
        );
      }
      measureFunctionPerformance('handler:completed:success', performance);
      return apigw.formulateApiResponseSuccess(getAllResult, contextualInformation);
    } else if (routeKey === 'GET /helloworld/{id}') {
      const requestId = event.pathParameters.id;
      const getRecordPayload = {
        id: requestId,
      };
      const recordResult = await dynamodbHelper.getRecordById(
        tableName,
        getRecordPayload,
        contextualInformation,
        performance,
      );
      if (recordResult.stack) {
        measureFunctionPerformance('handler:failure:logic', performance);
        return apigw.formulateApiResponseBadRequest(
          { errorMessage: 'Bad Request' },
          contextualInformation,
        );
      } else if (Object.keys(recordResult).length === 0 && recordResult.constructor === Object) {
        measureFunctionPerformance('handler:failure:logic', performance);
        return apigw.formulateApiResponseBadRequest(
          { errorMessage: 'No Record Found' },
          contextualInformation,
        );
      }
      measureFunctionPerformance('handler:completed:success', performance);
      return apigw.formulateApiResponseSuccess(recordResult, contextualInformation);
    } else if (routeKey === 'PUT /helloworld/{id}') {
      const payload = JSON.parse(event.body);
      const requestId = event.pathParameters.id;
      const putRecordPayload = {
        id: requestId,
        ...payload,
      };
      const recordResult = await dynamodbHelper.createOrUpdateRecord(
        tableName,
        putRecordPayload,
        contextualInformation,
        performance,
      );
      if (recordResult.stack) {
        measureFunctionPerformance('handler:failure:logic', performance);
        return apigw.formulateApiResponseBadRequest(
          { errorMessage: 'Bad Request' },
          contextualInformation,
        );
      }
      measureFunctionPerformance('handler:completed:success', performance);
      return apigw.formulateApiResponseSuccess(recordResult, contextualInformation);
    } else if (routeKey === 'DELETE /helloworld/{id}') {
      const requestId = event.pathParameters.id;
      const deleteRecordPayload = {
        id: requestId,
      };
      const recordResult = await dynamodbHelper.deleteRecordById(
        tableName,
        deleteRecordPayload,
        contextualInformation,
        performance,
      );
      if (recordResult.stack) {
        measureFunctionPerformance('handler:failure:logic', performance);
        return apigw.formulateApiResponseBadRequest(
          { errorMessage: 'Bad Request' },
          contextualInformation,
        );
      }
      measureFunctionPerformance('handler:completed:success', performance);
      return apigw.formulateApiResponseNoContent(null, contextualInformation);
    }
    measureFunctionPerformance('handler:completed:success', performance);
    return apigw.formulateApiResponseSuccess({ success: true }, contextualInformation);
  } catch (err) {
    logger.error(
      err,
      lambdaHelper.formatLog(
        `${functionName}:index`,
        'request:failed:catch',
        contextualInformation,
      ),
    );
    measureFunctionPerformance('handler:failure:error', performance);
    return apigw.formulateApiResponseError(
      { errorMessage: 'Internal Server Error' },
      contextualInformation,
    );
  }
};

const measureFunctionPerformance = (name, performance) => {
  performance.mark(name);
  performance.measure(`measure:${name}`, 'handler:initialize', name);
};
