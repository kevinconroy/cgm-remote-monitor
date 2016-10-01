'use strict';

var _ = require('lodash');
var should = require('should');
var moment = require('moment');

var env = require('../env')();
var loop = require('../lib/plugins/loop')();
var sandbox = require('../lib/sandbox')();
var levels = require('../lib/levels');

var statuses = [
  {
     'created_at':'2016-08-13T20:09:15Z',
     'device':'loop://ExamplePhone',
     'loop':{
        'enacted':{
           'timestamp':'2016-08-13T20:09:15Z',
           'rate':0.875,
           'duration':30,
           'received':true
        },
        'version':'0.9.1',
        'recommendedBolus':0,
        'timestamp':'2016-08-13T20:09:15Z',
        'predicted':{
           'startDate':'2016-08-13T20:03:47Z',
           'values':[
              149,
              149,
              148,
              148,
              147,
              147
           ]
        },
        'iob':{
           'timestamp':'2016-08-13T20:05:00Z',
           'iob':0.1733152537837709
        },
        'name':'Loop'
     }
  },
  {
     'created_at':'2016-08-13T20:04:15Z',
     'device':'loop://ExamplePhone',
     'loop':{
        'version':'0.9.1',
        'recommendedBolus':0,
        'timestamp':'2016-08-13T20:04:15Z',
        'failureReason':'SomeError',
        'name':'Loop'
     }
  },
  {
    'created_at':'2016-08-13T01:13:20Z',
    'device':'loop://ExamplePhone',
    'loop':{
      'timestamp':'2016-08-13T01:18:20Z',
      'version':'0.9.1',
      'iob':{
        'timestamp':'2016-08-13T01:15:00Z',
        'iob':-0.1205140849137931
      },
      'name':'Loop'
    }
  },
  {
    'created_at':'2016-08-13T01:13:20Z',
    'device':'loop://ExamplePhone',
    'loop':{
      'timestamp':'2016-08-13T01:13:20Z',
      'version':'0.9.1',
      'iob':{
        'timestamp':'2016-08-13T01:10:00Z',
        'iob':-0.1205140849137931
      },
      'failureReason':'StaleDataError(\"Glucose Date: 2016-08-12 23:23:49 +0000 or Pump status date: 2016-08-13 01:13:10 +0000 older than 15.0 min\")',
      'name':'Loop'
    }
  },
  {
    'created_at':'2016-08-13T01:13:15Z',
    'pump':{
      'reservoir':90.5,
      'clock':'2016-08-13T01:13:10Z',
      'battery':{
        'status':'normal',
        'voltage':1.5
      },
      'pumpID':'543204'
    },
    'device':'loop://ExamplePhone',
    'uploader':{
      'timestamp':'2016-08-13T01:13:15Z',
      'battery':43,
      'name':'ExamplePhone'
    }
  }
];

var now = moment(statuses[0].created_at);

_.forEach(statuses, function updateMills (status) {
  status.mills = moment(status.created_at).valueOf();
});

describe('loop', function ( ) {

  it('should set the property and update the pill and add forecast points', function (done) {
    var ctx = {
      settings: {
        units: 'mg/dl'
      }
      , pluginBase: {
        updatePillText: function mockedUpdatePillText (plugin, options) {
          options.label.should.equal('Loop ⌁');
          options.value.should.equal('1m ago');
          var first = _.first(options.info);
          first.label.should.equal('1m ago');
          first.value.should.equal('<b>Temp Basal Started</b> 0.88U/hour for 30m, IOB: 0.17U');
        }
        , addForecastPoints: function mockAddForecastPoints (points) {
          points.length.should.equal(6);
          done();
        }
      }
    };

    var sbx = sandbox.clientInit(ctx, now.valueOf(), {devicestatus: statuses});

    var unmockedOfferProperty = sbx.offerProperty;
    sbx.offerProperty = function mockedOfferProperty (name, setter) {
      name.should.equal('loop');
      var result = setter();
      should.exist(result);

      result.display.symbol.should.equal('⌁');
      result.display.code.should.equal('enacted');

      sbx.offerProperty = unmockedOfferProperty;
      unmockedOfferProperty(name, setter);
    };

    loop.setProperties(sbx);
    loop.updateVisualisation(sbx);
  });

  it('should show errors', function (done) {
    var ctx = {
      settings: {
        units: 'mg/dl'
      }
      , pluginBase: {
        updatePillText: function mockedUpdatePillText (plugin, options) {
          options.label.should.equal('Loop x');
          options.value.should.equal('1m ago');
          var first = _.first(options.info);
          first.label.should.equal('1m ago');
          first.value.should.equal('Error: SomeError');
          done();
        }
      }
    };

    var errorTime = moment(statuses[1].created_at);

    var sbx = sandbox.clientInit(ctx, errorTime.valueOf(), {devicestatus: statuses});

    var unmockedOfferProperty = sbx.offerProperty;
    sbx.offerProperty = function mockedOfferProperty (name, setter) {
      name.should.equal('loop');
      var result = setter();
      should.exist(result);

      result.display.symbol.should.equal('x');
      result.display.code.should.equal('error');

      sbx.offerProperty = unmockedOfferProperty;
      unmockedOfferProperty(name, setter);
    };

    loop.setProperties(sbx);

    loop.updateVisualisation(sbx);

  });


  it('should check the recieved flag to see if it was received', function (done) {
    var ctx = {
      settings: {
        units: 'mg/dl'
      }
      , notifications: require('../lib/notifications')(env, ctx)
    };

    ctx.notifications.initRequests();

    var notStatuses = _.cloneDeep(statuses);
    notStatuses[0].loop.enacted.received = false;
    var sbx = require('../lib/sandbox')().clientInit(ctx, now, {devicestatus: notStatuses});

    sbx.offerProperty = function mockedOfferProperty (name, setter) {
      name.should.equal('loop');
      var result = setter();
      should.exist(result);
      result.display.symbol.should.equal('x');
      result.display.code.should.equal('error');
      done();
    };

    loop.setProperties(sbx);
  });

  it('should generate an alert for a stuck loop', function (done) {
    var ctx = {
      settings: {
        units: 'mg/dl'
      }
      , notifications: require('../lib/notifications')(env, ctx)
    };

    ctx.notifications.initRequests();

    var sbx = sandbox.clientInit(ctx, now.add(2, 'hours').valueOf(), {devicestatus: statuses});
    sbx.extendedSettings = { 'enableAlerts': 'TRUE' };
    loop.setProperties(sbx);
    loop.checkNotifications(sbx);

    var highest = ctx.notifications.findHighestAlarm('Loop');
    highest.level.should.equal(levels.URGENT);
    highest.title.should.equal('Loop isn\'t looping');
    done();
  });

});