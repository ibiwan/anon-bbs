'use strict';

const router      = require('express').Router();
const MongoClient = require('mongodb').MongoClient;

const {
  getThreads, 
  createThread,
  deleteThread,
  flagThread
} = require('../services/threads');

const {
  getFullThread,
  createReply, 
  deleteReply,
  flagReply
} = require('../services/replies');

const DB_CONN    = process.env.DB;
const BBS_DBNAME = process.env.BBS_DBNAME;
const client     = new MongoClient(DB_CONN, { useNewUrlParser: true });

const extract = (paths, container) => {
  let defs = {};
  if(typeof paths === 'object' && paths !== null){
    Object.keys(paths).forEach(k => {
      const newDefs = extract(paths[k], container[k]);
      defs = {...defs, ...newDefs};
    });
  } else {
    defs = {
      ...defs,
      [paths]:container,
    };
  }
  return defs;
}

const parseReq = req => {
  const shape = {
    params : {
      board           : 'board',
      delete_password : 'delete_password_params',
      thread_id       : 'thread_id_params',
      reply_id        : 'reply_id_params',
    },
    query : {
      delete_password : 'delete_password_query',
      thread_id       : 'thread_id_query',
      reply_id        : 'reply_id_query',
    },
    body   : {
      text            : 'text',
      delete_password : 'delete_password_body',
      thread_id       : 'thread_id_body',
      reply_id        : 'reply_id_body',
    },
  };
  const extracted =  extract(shape, req);
  extracted.delete_password = extracted.delete_password_params || extracted.delete_password_query || extracted.delete_password_body;
  extracted.thread_id       = extracted.thread_id_params       || extracted.thread_id_query       || extracted.thread_id_body;
  extracted.reply_id        = extracted.reply_id_params        || extracted.reply_id_query        || extracted.reply_id_body;
 
  // console.log({extracted, params:req.params, query:req.query, body:req.body});
  
  return extracted;
}

function catchAsync(fn) {
  return function(req, res, next) {
    fn(req, res, next).catch(next);
  };
}

client.connect(function(err) {
  if(err){
    console.log("Could not start server", err);
  };
  
  const db = client.db(BBS_DBNAME);
  
  router.route('/threads/:board')
  
    // GET THREADS
    .get(catchAsync(async (req, res) => {
      const { board } = parseReq(req);

      const threads = await getThreads(
        db, 
        { board }
      );

      return res.success({ threads });
    }))
  
    // CREATE THREAD  
    .post(catchAsync(async (req, res) => {
      const { board, text, delete_password } = parseReq(req);

      const newId = await createThread( 
        db, 
        { board, text, delete_password   }
      );
      
      res.header('x-new-id', newId);
      return res.redirect(`/b/${board}`);
    }))
  
    // REPORT THREAD
    .put(catchAsync(async (req, res) => {
      const { board, thread_id } = parseReq(req);

      await flagThread(
        db, 
        { board, thread_id }
      );

      return res.success({message:'success'});
    }))
  
    // DELETE THREAD
    .delete(catchAsync(async (req, res) => {
      const { board, thread_id, delete_password } = parseReq(req);
      // console.log('b', {board, thread_id, delete_password});
    
      await deleteThread(
        db, 
        { board, thread_id, delete_password }
      );

      return res.success({message:'success'});
    }));

  router.route('/replies/:board')
  
    // GET FULL THREAD
    .get(catchAsync(async (req, res) => {
      const { board, thread_id } = parseReq(req);

      const thread = await getFullThread(
        db, 
        {board, thread_id}
      );

      return res.success({thread});
    }))
  
    // CREATE REPLY
    .post(catchAsync(async (req, res) => {
      const { board, text, thread_id, delete_password } = parseReq(req);
      
      const newId = await createReply(
        db,
        { board, text, delete_password, thread_id }
      );
      
      res.header('x-new-id', newId);
      return res.redirect(`/b/${board}/${thread_id}`);
    }))
  
    // REPORT REPLY
    .put(catchAsync(async (req, res) => {
      const { board, thread_id, reply_id } = parseReq(req);
          
      await flagReply(
        db, 
        { thread_id, reply_id }
      );

      return res.success({message:'success'});
    }))
  
    // DELETE REPLY
    .delete(catchAsync(async (req, res) => {
      const {thread_id, reply_id, delete_password} = parseReq(req);
      
      await deleteReply(
        db,
        {thread_id, reply_id, delete_password}
      );

      return res.success({message:'success'});
    }));

  router.use(function(error, req, res, next) {
    const message = error.message || error;
    console.log("error:", message);
    res.error(message);
  });
});

module.exports = router;
