module.exports = {
  friendlyName: 'Negotiate',
  description: 'Negotiate the proper way to handle an error in an action',
  sync: true,

  inputs: {
    res: {
      type: 'ref',
      description: 'A Sails response object',
      required: true
    },
    err: {
      type: 'ref',
      description: 'An error object to negotiate',
      defaultTo: {}
    }
  },

  exits: {},

  fn: function({ res, err }, exits) {
    let errResp;
    let status = '400';
    let title = 'Server Error';

    if (err.name === 'AdapterError') {
      if (err.code === 'E_UNIQUE') {
        title = 'Uniqueness Constraint Upheld';
        status = '422';
        errResp = res.unprocessableEntity;
      }
      status = '500';
      errResp = res.serverError;
    } else if (err.name === 'UsageError') {
      title = 'Validation Error';
      status = '422';
      errResp = res.unprocessableEntity;
    } else if (err.code === 'UNSUPPORTED_INCLUDE') {
      title = 'Unsupported Include Param';
      errResp = res.badRequest;
    } else if (err.code === 'singularModelSubcriteria') {
      title = 'Bad Request';
      errResp = res.badRequest;
    } else {
      title = 'Server Error';
      status = '500';
      errResp = res.serverError;
    }

    // Return the correct error type with the populated body
    return exits.success(errResp(sails.helpers.jsonifyError.with({ err, status, title })));
  }
};
