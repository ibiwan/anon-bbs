'use strict';

const bcrypt = require('bcrypt');
const ObjectId = require('mongodb').ObjectId;

const REPLIES_COLL = process.env.REPLIES_COLLECTION;
const THREADS_COLL = process.env.THREADS_COLLECTION;
const TEST_MODE    = process.env.NODE_ENV === 'test'

const getThreads = async(db, {board}) => {
  // return: 10 most recently-bumped threads, 3 most recent replies each
  // do not return fields: reported, delete_password

  const agg_query = [
    {$match: {
      board,
      deleted_on: null,
    }},
    {$sort: {
      bumped_on: -1,
    }},
    {$limit: 10},
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
        {$limit: 3},
        {$project: {
          reported: false,
          delete_password: false,
        }},
      ],
      as: 'replies',
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
        {$count: 'replycount'},
      ],
      as: 'replycount',
    }},
  ];
  
  return await db.collection(THREADS_COLL).aggregate(agg_query).toArray();
};

const createThread = async(db, data) => {
  // body: {text, delete_password}
  // save: {_id, text, created_on, bumped_on,
  //        reported:false, delete_password, replies:[]}
  // redirect: /b/:board on success

  const {board, text, delete_password, startTime} = data;

  const now = new Date();
  const pass_hash = await bcrypt.hash(delete_password, TEST_MODE ? 2 : 12);

  const thread = {
    board,
    text,
    delete_password: pass_hash,
    created_on: now,
    bumped_on: now,
    deleted_on: null,
    reported: false,
  };

  const result = await db.collection(THREADS_COLL).insertOne(thread);
  if (!result.insertedCount || !result.insertedId){
    console.log('create thread fail:', {result});
    throw new Error('thread could not be created');
  }

  return result.insertedId;
};

const flagThread = async(db, {board, thread_id}) => {
  const query = {
    board,
    _id: ObjectId(thread_id),
    deleted_on: null,
  };

  const thread = await db.collection(THREADS_COLL).findOne(query);
  if (!thread){
    throw new Error('no thread with that board and id was found');
  }

  thread.reported = true;

  const result = await db.collection(THREADS_COLL).replaceOne(query, thread);
  if (!result.result.nModified){
    console.log('flag thread fail:', {result});
    throw new Error('thread could not be flagged');
  }

  return true;
};

const deleteThread = async(db, {board, thread_id, delete_password}) => {
  // body:{thread_id, delete_password}
  // delete entire thread from db (or hide from returns)
  // return: 'incorrect password' or 'success'

  // console.log({thread_id});
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
  
  const pass_match = await bcrypt.compare(
    delete_password,
    thread.delete_password
  );
  if (!pass_match){
    throw new Error('incorrect password');
  }
  
  thread.deleted_on = new Date();

  const result = await db.collection(THREADS_COLL).replaceOne(query, thread);
  if (!result.result.nModified){
    console.log('delete thread fail:', {result});
    throw new Error('thread could not be deleted');
  }

  return true;
};


module.exports = {
  getThreads,
  createThread,
  flagThread,
  deleteThread,
};
