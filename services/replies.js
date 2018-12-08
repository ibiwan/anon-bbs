'use strict';

const bcrypt = require('bcrypt');
const ObjectId = require('mongodb').ObjectId;

const REPLIES_COLL = process.env.REPLIES_COLLECTION;
const THREADS_COLL = process.env.THREADS_COLLECTION;
const TEST_MODE    = process.env.NODE_ENV === 'test'

const getFullThread = async(db, {board, thread_id}) => {
  // query: thread_id
  // return: entire thread and replies
  // do not return fields: reported, delete_password

  const thread = await db.collection(THREADS_COLL).aggregate([
    {$match: {
      board,
      _id: ObjectId(thread_id),
      deleted_on: null,
    }},
    {$project: {
      board: false,
      reported: false,
      delete_password: false,
    }},
    {$lookup: {
      from: REPLIES_COLL,
      let: {thread_id: '$_id'},
      pipeline: [
        {$match: {$expr: {
          $and: [
            {$eq: [ '$thread_id', '$$thread_id' ] },
            {$eq: [ '$deleted_on', null ] },
          ],
        }}},
        {$sort: {
          created_on: -1,
        }},
      ],
      as: 'replies',
    }},
  ]).toArray();

  return thread ? thread[0] : null;
};

const createReply = async(db, {board, text, delete_password, thread_id, startTime}) => {
  // body: {text, delete_password, thread_id}
  // save to thread's replies array:
  //    {_id, text, created_on, delete_password, reported:false}
  // update thread's bumped_on to current
  // redirect to /b/:board/:thread_id

  const now = new Date();

  const query = {
    board,
    _id: ObjectId(thread_id),
    deleted_on: null,
  };
  const thread = await db.collection(THREADS_COLL).findOne(query);
  if (!thread){
    console.log('not found:', {query});
    throw new Error('no thread with that board and id was found');
  }

  thread.bumped_on = now;

  const pass_hash = await bcrypt.hash(delete_password, TEST_MODE ? 2 : 12);

  const reply = {
    text,
    thread_id: thread._id,
    delete_password: pass_hash,
    created_on: now,
    deleted_on: null,
    reported: false,
  };

  const results = await Promise.all([
    db.collection(REPLIES_COLL).insertOne(reply),
    db.collection(THREADS_COLL).replaceOne(query, thread),
  ]);

  if (results[0].insertedCount !== 1 || results[1].modifiedCount !== 1){
    console.log('create reply fail:', {results});
    throw new Error('reply could not be created');
  }

  return results[0].insertedId;
};

const flagReply = async(db, {thread_id, reply_id}) => {
  // body: {thread_id, reply_id}
  // return: 'success'

  const query = {
    thread_id: ObjectId(thread_id),
    _id: ObjectId(reply_id),
    deleted_on: null,
  };

  const reply = await db.collection(REPLIES_COLL).findOne(query);
  if (!reply){
    throw new Error('no reply with that thread id and reply id was found');
  }

  reply.reported = true;

  const result = await db.collection(REPLIES_COLL).replaceOne(query, reply);
  if (!result.result.nModified){
    console.log('flag reply fail:', {result});
    throw new Error('reply could not be flagged');
  }

  return true;
};

const deleteReply = async(db, data) => {  
  // body:{thread_id, reply_id, delete_password}
  // change reply's text to [deleted]
  // return: 'incorrect password' or 'success'

  const {thread_id, reply_id, delete_password} = data;

  const query = {
    thread_id: ObjectId(thread_id),
    _id: ObjectId(reply_id),
    deleted_on: null,
  };
  
  const reply = await db.collection(REPLIES_COLL).findOne(query);
  if (!reply){
    throw new Error('no reply with that thread id and reply id was found');
  }
  
  const pass_match = await bcrypt.compare(
    delete_password,
    reply.delete_password
  );
  if (!pass_match){
    throw new Error('incorrect password');
  }

  reply.deleted_on = new Date();

  const result = await db.collection(REPLIES_COLL).replaceOne(query, reply);
  if (!result.result.nModified){
    console.log('delete reply fail:', {result});
    throw new Error('reply could not be deleted');
  }

  return true;
};

module.exports = {
  getFullThread,
  createReply,
  flagReply,
  deleteReply,
};
