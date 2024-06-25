import _ from 'lodash';
import { validate as validateUuid } from 'uuid';
import sqlite from 'sqlite3';
import sqlitePlugin from 'fastify-sqlite-typed';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import dotenv from 'dotenv';
import middie from '@fastify/middie';

dotenv.config();

const fastify = Fastify({
  logger: true,
});

await fastify.register(cors, {
  origin: '*',
});

await fastify.register(sqlitePlugin, {
  dbFilename: './db.sqlite',
});

await fastify.register(middie);

const authPreHandler = (request, reply, done) => {
  const auth = request.headers.authorization;
  if (!auth || !auth.startsWith('Basic ')) {
    return reply.status(401).send({ status: 200, message: 'Invalid authentication' });
  }
  const [username, password] = atob(auth.split(' ')[1]).split(':');
  if (username !== 'Secret_Username' || password !== 'Secret_Password') {
    return reply.status(401).send({ status: 401, message: 'Invalid credentials' });
  }
  done();
};

const db = new sqlite.Database('./db.sqlite');
db.run(`CREATE TABLE IF NOT EXISTS transactions (
  transaction_id INTEGER PRIMARY KEY AUTOINCREMENT, 
  user_id TEXT,
  to_account_number TEXT,
  from_account_number TEXT,
  amount TEXT,
  created_date TEXT,
  status BOOLEAN
)`);

const SUCCESS_CODE = 100;
const FAILURE_CODE = 101;
const SUSPICIOUS_CODE = 102;

const CODES = [SUCCESS_CODE, FAILURE_CODE, SUSPICIOUS_CODE, SUCCESS_CODE, SUCCESS_CODE, SUCCESS_CODE, SUCCESS_CODE, SUCCESS_CODE, SUCCESS_CODE, SUCCESS_CODE];

fastify.get('/docs', async function handler(request, reply) {
  return {
    endpoints: [
      { path: '/health', method: 'GET', info: 'check if the API is working' },
      { path: '/get-credentials', method: 'POST', info: 'get credentials for third party api. use basic authentication i.e. Username/Password for subsequent requests' },
      {
        path: '/make-payment',
        method: 'POST',
        info: 'the main functinoality of this api. will store the txn details in sqlite db',
        requestBody: {
          userId: 'bed66608-7b7f-4772-b646-b89cb6d7dc6b //must be uuid',
          toAccountNumber: '1092340293840 //cannot be same',
          fromAccountNumber: '1092340293841 //cannot be same',
          amount: '100 //must be greater than 100',
        },
      },
      { path: '/get-transaction-details/:id', method: 'GET', info: 'get txn details by txn id. the txn id can be found in the response of /make-payment' },
    ],
    statusCodes: { SUCCESS_CODES: [100, 200], FAILURE_CODES: [101, 400, 401], SUSPICIOUS_CODES: [102, 200, 400] },
  };
});

fastify.get('/health', async function handler(request, reply) {
  return { status: 'OK' };
});

fastify.post('/get-credentials', async function handler(request, reply) {
  return { username: 'Secret_Username', password: 'Secret_Password' };
});

fastify.route({
  method: 'POST',
  url: '/make-payment',
  preHandler: authPreHandler,
  handler: async function handler(request, reply) {
    const { userId, toAccountNumber, fromAccountNumber, amount } = request.body;

    if (validateUuid(userId) === false) {
      reply.status(400).send({
        status: 400,
        message: 'Invalid user id. Must be a uuid v4',
      });
    }

    if (toAccountNumber === fromAccountNumber) {
      reply.status(400).send({
        status: 400,
        message: 'Sender and receiver cannot be same',
      });
    }

    if (isNaN(amount) || amount <= 100) {
      reply.status(400).send({
        status: 400,
        message: 'Amount must be greater than 100',
      });
    }

    const randomCode = _.sample(CODES);

    if (randomCode == FAILURE_CODE) {
      return {
        status: FAILURE_CODE,
        message: 'Could not complete transacation. Service could be unavailable temporarily',
        txnDetail: JSON.stringify({ txnDetails: null, status: FAILURE_CODE, message: 'Could not complete transacation. Service could be unavailable temporarily' }),
      };
    }

    const result = await fastify.db.get(
      `INSERT INTO transactions (user_id, to_account_number, from_account_number, amount, status, created_date) VALUES (?, ?, ?, ?, ?, ?) RETURNING transaction_id`,
      [userId, toAccountNumber, fromAccountNumber, amount, randomCode == SUCCESS_CODE, Date.now()]
    );
    const [txnDetails] = await fastify.db.all(`SELECT * FROM transactions WHERE transaction_id = ?`, [result.transaction_id]);
    return {
      status: SUCCESS_CODE,
      message: randomCode == SUCCESS_CODE ? 'Transaction completed successfully' : 'Suspicious transaction. Please validate the transaction status with txn Id',
      txnDetail: JSON.stringify({ ...txnDetails, status: randomCode }),
    };
  },
});

fastify.route({
  method: 'GET',
  url: '/get-transaction-details/:id',
  preHandler: authPreHandler,
  handler: async function handler(request, reply) {
    const txnDetails = await fastify.db.all(`SELECT * FROM transactions WHERE transaction_id = ?`, [request.params.id]);
    return { ...txnDetails, status: SUCCESS_CODE, message: 'Data fetched successfully' };
  },
});

try {
  await fastify.listen({ port: process.env.PORT || 3000, host: '0.0.0.0' });
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
