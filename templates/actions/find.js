/**
 * find
 *
 * returns a function with access to an interruption context
 *
 * @description :: Server-side logic for a generic crud controller find action that can be used to represent all models
 * @help        :: See http://sailsjs.org/#!/documentation/concepts/Controllers
 */
const actionUtil = require('./../util/actionUtil');
const shimFunction = require('./../util/shimFunction');
const defaultInterrupt = require('./../interrupts/defaultInterrupt');
const { parallel, waterfall } = require('async');
const { map } = require('lodash');

module.exports = function(interrupts = {}) {
  interrupts = shimFunction(interrupts, 'find');
  interrupts.find = interrupts.find ? interrupts.find : defaultInterrupt;

  return function(req, res) {
    // Set the JSONAPI required header
    res.set('Content-Type', 'application/vnd.api+json');

    // Look up the model
    const Model = actionUtil.parseModel(req);
    // parse criteria from request
    const criteria = actionUtil.parseCriteria(req);
    const limit = actionUtil.parseLimit(req);

    // Look up the association configuration based on the reserved 'include' keyword
    const { include = '' } = criteria;
    const associations = sails.helpers.getAssociationConfig.with({ model: Model, include: include.split(',') });
    delete criteria.include; // Include is no longer required

    waterfall([
      (cb) => parallel(
        {
          count(done) {
            Model.count(criteria).exec(done);
          },
          records(done) {
            // Lookup for records that match the specified criteria
            const query = Model.find()
              .where(criteria)
              .skip(actionUtil.parseSkip(req))
              .sort(actionUtil.parseSort(req));
            if (limit) query.limit(limit);

            // populate associations according to our model specific configuration...
            actionUtil.populateRecords(query, associations).exec(done);
          }
        },
        (err, results) => {
          if (err) {
            return actionUtil.negotiate(res, err, actionUtil.parseLocals(req));
          }

          cb(null, results);
        }
      ),
      (results, cb) => {
        const { records } = results;
        parallel(records.reduce((acc, record) => {
          const recordId = record[Model.primaryKey];
          acc[recordId] = (next) => parallel(Model.associations.reduce((acc2, assoc) => {
            return Object.assign({}, acc2, {
              [assoc.alias]: (done) => sails.helpers.countRelationship
                .with({ model: Model, association: assoc, pk: recordId })
                .then(result => done(null, result))
            });
          }, {}), next);

          return acc;
        }, {}), (err, result) => {
          if (err) {
            return actionUtil.negotiate(res, err, actionUtil.parseLocals(req));
          }
          cb(null, Object.assign({}, results, { meta: { relationships: { count: result }}}))
        }); 
      }],
      (err, results) => {
        if (err) {
          return actionUtil.negotiate(res, err, actionUtil.parseLocals(req));
        }

        const { records, meta } = results;
        const ids = records.map(record => {
          return record[Model.primaryKey];
        });
        actionUtil.populateIndexes(Model, ids, associations, (err, associated) => {
          if (err) {
            return actionUtil.negotiate(res, err, actionUtil.parseLocals(req));
          }
          interrupts.find.call(
            this,
            req,
            res,
            () => {
              // Only `.watch()` for new instances of the model if
              // `autoWatch` is enabled.
              if (req._sails.hooks.pubsub && req.isSocket) {
                Model.subscribe(req, map(records, Model.primaryKey));
                if (req.options.autoWatch) {
                  Model._watch(req);
                }
                // Also subscribe to instances of all associated models
                // @todo this might need an update to include associations included by index only
                records.forEach(record => {
                  actionUtil.subscribeDeep(req, record);
                });
              }
              const specJSON = sails.helpers.buildJsonApiResponse.with({
                model: Model,
                records: records,
                meta: Object.assign({ total: results.count }, meta)
              });
              res.ok(specJSON, actionUtil.parseLocals(req));
            },
            Model,
            records
          );
        });
      }
    );
  };
};
