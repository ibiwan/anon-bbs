'use strict';

/*global suite test*/

const chaiHttp    = require('chai-http');
const chai        = require('chai');
const assert      = chai.assert;
const server      = require('../server');
const MongoClient = require('mongodb').MongoClient;
const ObjectId    = require('mongodb').ObjectId;

const DB_CONN      = process.env.DB;
const BBS_DBNAME   = process.env.BBS_DBNAME;
const THREADS_COLL = process.env.THREADS_COLLECTION;
const REPLIES_COLL = process.env.REPLIES_COLLECTION;

const mongo_id_length        = 24;

const max_threads_returned   = 10;
const max_replies_per_thread = 3;

const boards_to_create       = 1;
const threads_to_create      = max_threads_returned + 2;
const replies_to_create      = max_replies_per_thread + 2;

const threads_to_bump        = 3;

const board_for_tests        = 0;
const thread_to_delete       = 7;
const thread_to_report       = 2;

const thread_for_reply_tests = 5;
const reply_to_report        = 1;
const reply_to_delete        = 2;

const client = new MongoClient(DB_CONN, { useNewUrlParser: true });

chai.use(chaiHttp);

const timeout = ms => new Promise(resolve => setTimeout(resolve, ms));

const boards = {};

suite('Functional Tests', function() {
  
  suite('DB Clearer Suite', function(){
    
    test('DB Clearer Test', function(done){
      
      client.connect(async function(err) {
        
        if(err){
          console.log("Could not start server", err);
        };

        const db = client.db(BBS_DBNAME);

        await db.collection(THREADS_COLL).deleteMany({});
        await db.collection(REPLIES_COLL).deleteMany({});

        assert.isTrue(true);
        
        done();
      }); // mongo client connect
      
    }); // db clearer test

  }); // db clearer suite

  suite('API ROUTING FOR /api/threads/:board', function() {
    
    suite('POST', function() {
      
      test('test: create threads: successful', function(done){
        
        this.timeout(4000);
        
        const asyncTester = async () => {
          
          const createdThreads = [];
          for(let b = 0; b < boards_to_create; b++){

            const board = `test-board-${b}`;          

            const threads = {};
            for(let t = 0; t < threads_to_create; t++){
              
              const thread_uri  = `/api/threads/${board}`;
              const thread_text = `${board}-thread-${t}`;
              const thread_pass = `${board}-thread-pass-${t}`;
              
              const threadData = await chai.request(server)
                .post(thread_uri)
                .send({ 
                  text : thread_text,
                  delete_password:thread_pass 
                })
                .redirects(0)
                .then(response => {
                  const {
                    statusCode,
                    header : {
                      location,
                      'x-new-id' : threadId,
                    },
                  } = response

                  assert.oneOf(statusCode, [301, 302]);
                  assert.isString(threadId);
                  assert.equal(threadId.length, mongo_id_length);
                  assert.equal(location, `/b/${board}`);

                  return {
                    board,
                    thread_text,
                    thread_pass,
                    statusCode,
                    location,
                    threadId,
                  };
                })
              createdThreads.push(threadData);

              threads[thread_text] = threadData;
            }

            boards[board] = {threads};
          }

          // reorder threads to confirm bump-on-reply behavior
          const oldThreadBumpResponses = createdThreads.slice(threads_to_bump, threads_to_create);
          const newThreadBumpResponses = createdThreads.slice(0,               threads_to_bump);
                    
          const reorderedThreads = [...oldThreadBumpResponses, ...newThreadBumpResponses];
          for(let n = 0; n < reorderedThreads.length; n++){
            const threadData = reorderedThreads[n];

            const {
              board, 
              thread_text, 
              thread_pass, 
              statusCode,
              location,
              threadId,
            } = threadData;
                        
            let replies = {};
            for(let r = 0; r < replies_to_create; r++){

              const reply_uri  = `/api/replies/${board}`;
              const reply_text = `${thread_text}-reply-${r}`;
              const reply_pass = `${thread_text}-reply-pass-${r}`;
              
              const data = await chai.request(server)
                .post(reply_uri)
                .send({ 
                  thread_id       : threadId,
                  text            : reply_text,
                  delete_password : reply_pass 
                })
                .redirects(0)
                .then(response => {
                  const {
                    statusCode,
                    header : {
                      location,
                      'x-new-id' : replyId,
                    },
                  } = response;

                  replies[reply_text] = {statusCode, location, reply_text, reply_pass, replyId}; // `/b/${board}/${thread_id}`
                })
            }          

            boards[board]['threads'][thread_text]['replies'] = replies;
          }
          
          done();
        }

        asyncTester();
      
      }); // create threads test -- success
    
    });  // threads tests -- POST

    suite('GET', function() {
      
      test('get threads success', function(done){
        
        const asyncTester = async () => {
          
          const responses = await Promise.all(
            Object.keys(boards).map(board => 
              chai.request(server)
                .get(`/api/threads/${board}`)
                .query({})
            ));

          responses.forEach(res => {
            
            const {
              statusCode,
              header,
              body : {
                success,
                threads,
                ...otherResponseFields
              },
            } = res;
            
            assert.equal(statusCode, 200);
            assert.isTrue(success);
            assert.isArray(threads);
            assert.isAtMost(threads.length, max_threads_returned);
            assert.deepEqual(otherResponseFields, {});
            
            let threadCount = 0;
            threads.forEach(thread => {
              
              const {
                _id : thread_id,
                text,
                created_on,
                bumped_on,
                deleted_on,
                replies,
                replycount,
                ...otherThreadFields
              } = thread;
              
              assert.isString(thread_id);
              assert.equal(thread_id.length, mongo_id_length);
              assert.isString(text);
              assert.isNull(deleted_on);
              assert.isArray(replies);
              assert.isAtMost(replies.length, max_replies_per_thread);
              assert.isAtLeast(replycount[0].replycount, replies.length);
              assert.deepEqual(otherThreadFields, {});
              
              const [whole, threadIdxStr] = text.match(/test-board-\d+-thread-(\d+)/);
              const threadIdx = parseInt(threadIdxStr);

              if(threadCount++ < threads_to_bump){
                assert.isBelow(threadIdx, threads_to_bump)
              }else{
                assert.isAtLeast(threadIdx, threads_to_bump)
              }
            });
          });
          
          done();
        }
        
        asyncTester();
        
      }); // GET threads success
    });

    suite('DELETE', function() {
      test('delete thread success', done => {
        
        const asyncTester = async () => {
          
          const boardIds   = Object.keys(boards);
          const board0name = boardIds[0];
          const board0     = boards[board0name];
          const threadIds  = Object.keys(board0.threads);
          const doomedId   = threadIds[thread_to_delete];
          const threadData = boards[board0name].threads[doomedId];
          const {
            thread_text,
            thread_pass,
            threadId,
          } = threadData;

          const response = await chai.request(server)
            .delete(`/api/threads/${board0name}`)
            .send({
              thread_id:threadId, 
              delete_password:thread_pass
            });
          
          const {
            statusCode,
            body : {
              success,
              message,
              ...otherFields
            }
          } = response;
        
          assert.equal(statusCode, 200);
          assert.isTrue(success);
          assert.equal(message, 'success');
          assert.deepEqual(otherFields, {});
          
          const getResponse = await chai.request(server)
                .get(`/api/threads/${board0name}`)
                .query({});
          
          const {
            statusCode : getStatus,
            header     : getHeader, 
            body       : {
              success : getSuccess,
              threads : getThreads,
              ...otherGetFields
            },
          } = getResponse;

          assert.equal(getStatus, 200);
          assert.isTrue(getSuccess);
          assert.deepEqual(otherGetFields, {});
          assert.isArray(getThreads);

          getThreads.forEach(thread => {

            const {
              _id : thread_id,
              text,
              created_on,
              bumped_on,
              deleted_on,
              replies,
              replycount,
              ...otherThreadFields
            } = thread;

            assert.isString(thread_id);
            assert.equal(thread_id.length, mongo_id_length);
            assert.isString(text);
            assert.isNull(deleted_on);
            assert.isArray(replies);
            assert.isAtMost(replies.length, max_replies_per_thread);
            assert.isAtLeast(replycount[0].replycount, replies.length);
            assert.deepEqual(otherThreadFields, {});

            assert.notEqual(thread_id, doomedId);
            assert.notEqual(text, thread_text);
          })

          done();

        };
        
        asyncTester();
      })
    });

    suite('PUT', function() {

      test('report thread success', done => {
        
        const asyncTester = async () => {
          
          const boardIds   = Object.keys(boards);
          const board0name = boardIds[0];
          const board0     = boards[board0name];
          const threadIds  = Object.keys(board0.threads);
          const doomedId   = threadIds[thread_to_report];
          const threadData = boards[board0name].threads[doomedId];
          const {
            thread_text,
            thread_pass, 
            threadId,
          } = threadData;

          const response = await chai.request(server)
            .put(`/api/threads/${board0name}`)
            .send({
              thread_id:threadId
            });
          
          const {
            statusCode,
            body : {
              success,
              message,
              ...otherFields
            }
          } = response;
        
          assert.equal(statusCode, 200);
          assert.isTrue(success);
          assert.equal(message, 'success');
          assert.deepEqual(otherFields, {});

          done();

        };
        
        asyncTester();
      })
    });


  }); // threads routes

  suite('API ROUTING FOR /api/replies/:board', function() {

    suite('POST', function() {
      test('create replies', done => {
        
        const boardNames = Object.keys(boards);
        boardNames.forEach(boardName => {
          
          const board       = boards[boardName];          
          const threadNames = Object.keys(board.threads);
          threadNames.forEach(threadName => {
            
            const thread = board.threads[threadName];
            const {thread_text, threadId:thread_id, replies:thread_replies} = thread;
            const replyNames = Object.keys(thread_replies);
            replyNames.forEach(replyName => {

              const reply = thread_replies[replyName];
              const {statusCode, location, reply_text, reply_pass, replyId:reply_id} = reply

              assert.oneOf(statusCode, [301, 302]);
              assert.equal(location, `/b/${boardName}/${thread_id}`);
              assert.isString(reply_id);
              assert.equal(reply_id.length, mongo_id_length);
              assert.isString(reply_text);
              assert.isString(thread_id);
              assert.equal(thread_id.length, mongo_id_length);

            });
          });
        });
        
        assert.isTrue(true);
        done();
      });
    });

    suite('GET', function() {
      test('get reply success', done => { 
        const asyncTester = async () => {
          
          const boardNames = Object.keys(boards);
          boardNames.forEach(async boardName => {
          
            const board       = boards[boardName];          
            const threadNames = Object.keys(board.threads);
            threadNames.forEach(async threadName => {
            
              const thread = board.threads[threadName];
     
              const {
                threadId : thread_id,
                thread_text,
                thread_pass,
                statusCode,
                location,
                replies,
                ...otherThreadFields
              } = thread;              
              
              const [whole, threadIdxStr] = thread_text.match(/test-board-\d+-thread-(\d+)/);
              const threadIdx = parseInt(threadIdxStr);
                            
              if(threadIdx === thread_for_reply_tests){
                
                const response = await chai.request(server)
                  .get(`/api/replies/${boardName}`)
                  .query({thread_id});
                
                const {
                  statusCode,
                  body : {
                    success,
                    thread : {
                      _id  : response_thread_id,
                      text : thread_text,
                      created_on, 
                      bumped_on,
                      deleted_on,
                      replies,
                      ...otherThreadFields
                    },
                    ...otherBodyFields
                  },
                } = response;
                                                
                assert.equal(statusCode, 200);
                assert.isTrue(success);
                assert.deepEqual(otherBodyFields, {});
                assert.isString(response_thread_id);
                assert.equal(thread_id.length, mongo_id_length);
                assert.isString(thread_text);
                assert.isNull(deleted_on);
                assert.isArray(replies);
                assert.isAbove(replies.length, max_replies_per_thread);
                assert.deepEqual(otherThreadFields, {});
                
              }
            });
          });
          done();
        }; 
        asyncTester(); 
      });
    });

    suite('PUT', function() {
      test('report reply success', done => { 
        const asyncTester = async () => {
          
          const boardNames = Object.keys(boards);
          boardNames.forEach(async boardName => {
          
            const board       = boards[boardName];          
            const threadNames = Object.keys(board.threads);
            threadNames.forEach(async threadName => {
            
              const thread = board.threads[threadName];
     
              const {
                threadId : thread_id,
                thread_text,
                replies,
              } = thread;              
              
              const [whole, threadIdxStr] = thread_text.match(/test-board-\d+-thread-(\d+)/);
              const threadIdx = parseInt(threadIdxStr);
                            
              if(threadIdx === thread_for_reply_tests){
                
                const replyNames = Object.keys(replies);
                replyNames.forEach(async replyName => {

                  const reply = replies[replyName];
                  const {
                    replyId : reply_id,
                    reply_text,
                  } = reply;

                  const [whole, replyIdxStr] = reply_text.match(/test-board-\d+-thread-\d+-reply-(\d+)/);
                  const replyIdx = parseInt(replyIdxStr);
                  
                  if(replyIdx === reply_to_report){
                    
                    const response = await chai.request(server)
                      .put(`/api/replies/${boardName}`)
                      .query({thread_id, reply_id});          
                    
                    const {statusCode, body:{success, message, ...otherBodyFields}} = response;
                    
                    assert.equal(statusCode, 200);
                    assert.isTrue(success);
                    assert.equal(message, 'success');
                    assert.deepEqual(otherBodyFields, {});
                  }
                });
              }
            });
          });

          done();
        }; 
        asyncTester(); 
      });
    });

    suite('DELETE', function() {
      test('delete reply success', done => {
        const asyncTester = async () => { 
          
          const boardNames = Object.keys(boards);
          boardNames.forEach(async boardName => {
          
            const board       = boards[boardName];          
            const threadNames = Object.keys(board.threads);
            threadNames.forEach(async threadName => {
            
              const thread = board.threads[threadName];
     
              const {
                threadId : thread_id,
                thread_text,
                replies,
              } = thread;              
              
              const [whole, threadIdxStr] = thread_text.match(/test-board-\d+-thread-(\d+)/);
              const threadIdx = parseInt(threadIdxStr);
                            
              if(threadIdx === thread_for_reply_tests){
                
                const replyNames = Object.keys(replies);
                replyNames.forEach(async replyName => {

                  const reply = replies[replyName];
                  const {
                    replyId : reply_id,
                    reply_text,
                    reply_pass,
                  } = reply;
                  
                  const [whole, replyIdxStr] = reply_text.match(/test-board-\d+-thread-\d+-reply-(\d+)/);
                  const replyIdx = parseInt(replyIdxStr);
                  
                  if(replyIdx === reply_to_delete){
                    
                    const response = await chai.request(server)
                      .delete(`/api/replies/${boardName}`)
                      .query({
                        thread_id,
                        reply_id,
                        delete_password:reply_pass
                      });          
                    
                    const {statusCode, body:{success, message, ...otherBodyFields}} = response;
                    
                    assert.equal(statusCode, 200);
                    assert.isTrue(success);
                    assert.equal(message, 'success');
                    assert.deepEqual(otherBodyFields, {});
                  }
                });
                
                const response = await chai.request(server)
                  .get(`/api/replies/${boardName}`)
                  .query({thread_id});

                const {body:{thread}} = response;
                thread.replies.forEach(reply => {
                  const {_id:reply_id} = reply;
                  assert.notEqual(reply_id, reply_to_delete);
                })
              }
            });
          });
          
          done(); 
        };
        
        asyncTester();
      });
    });

  }); // replies routes

});
