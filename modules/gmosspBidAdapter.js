import { getCurrencyFromBidderRequest } from '../libraries/ortb2Utils/currency.js';
import { registerBidder } from '../src/adapters/bidderFactory.js';
import { BANNER } from '../src/mediaTypes.js';
import {
  createTrackPixelHtml,
  getBidIdParameter,
  getDNT,
  getWindowTop,
  isEmpty,
  logError,
  setOnAny,
  _each
} from '../src/utils.js';

/**
 * @typedef {import('../src/adapters/bidderFactory.js').BidRequest} BidRequest
 * @typedef {import('../src/adapters/bidderFactory.js').Bid} Bid
 * @typedef {import('../src/adapters/bidderFactory.js').BidderRequest} BidderRequest
 * @typedef {import('../src/adapters/bidderFactory.js').ServerResponse} ServerResponse
 * @typedef {import('../src/adapters/bidderFactory.js').SyncOptions} SyncOptions
 * @typedef {import('../src/adapters/bidderFactory.js').UserSync} UserSync
 * @typedef {import('../src/adapters/bidderFactory.js').validBidRequests} validBidRequests
 */

const BIDDER_CODE = 'gmossp';
const ENDPOINT = 'https://sp.gmossp-sp.jp/hb/prebid/query.ad';

export const spec = {
  code: BIDDER_CODE,
  supportedMediaTypes: [BANNER],

  /**
   * Determines whether or not the given bid request is valid.
   *
   * @param {BidRequest} bid The bid params to validate.
   * @return boolean True if this is a valid bid, and false otherwise.
   */
  isBidRequestValid: function (bid) {
    return !!(bid.params.sid);
  },

  /**
   * Make a server request from the list of BidRequests.
   *
   * @param {validBidRequests} validBidRequests an array of bids
   * @param {BidderRequest} bidderRequest
   * @return ServerRequest Info describing the request to the server.
   */
  buildRequests: function (validBidRequests, bidderRequest) {
    const requests = [];
    _each(validBidRequests, function(request) {
      requests.push({
        bid: request.bidId,
        sid: getBidIdParameter('sid', request.params),
      });
    });

    return [{
      method: 'POST',
      url: ENDPOINT,
      data: JSON.stringify({
        ver: '$prebid.version$',
        eids: {
          im_uid: setOnAny(validBidRequests, 'userId.imuid'),
          shared_id: setOnAny(validBidRequests, 'userId.pubcid'),
        },
        url_info: getUrlInfo(bidderRequest.refererInfo),
        cur: getCurrencyType(bidderRequest),
        dnt: getDNT() ? 1 : 0,
        device_sua: setOnAny(validBidRequests, 'ortb2.device.sua'),
        user_data: setOnAny(validBidRequests, 'ortb2.user.data'),
        requests: requests,
      }),
    }];
  },

  /**
   * Unpack the response from the server into a list of bids.
   *
   * @param {*} serverResponses A successful response from the server.
   * @param {*} request
   * @return {Bid[]} An array of bids which were nested inside the server.
   */
  interpretResponse: function (serverResponses, request) {
    const res = serverResponses.body;

    if (isEmpty(res)) {
      return [];
    }

    const bids = [];
    _each(res.bids, function(row) {
      let ad = row.ad;
      try {
        _each(row.imps, function(impTracker) {
          ad += createTrackPixelHtml(impTracker);
        });
      } catch (error) {
        logError('Error appending tracking pixel', error);
      }

      bids.push({
        requestId: row.bid,
        cpm: row.price,
        currency: res.cur,
        width: row.w,
        height: row.h,
        ad: ad,
        creativeId: row.creativeId,
        netRevenue: true,
        ttl: res.ttl || 300,
        adomains: row.adomains,
      });
    });
    return bids;
  },

  /**
   * Register the user sync pixels which should be dropped after the auction.
   *
   * @param {SyncOptions} syncOptions Which user syncs are allowed?
   * @param {ServerResponse[]} serverResponses List of server's responses.
   * @return {UserSync[]} The user syncs which should be dropped.
   */
  getUserSyncs: function (syncOptions, serverResponses) {
    const syncs = [];
    if (!serverResponses.length) {
      return syncs;
    }

    _each(serverResponses, function(res) {
      if (syncOptions.pixelEnabled && res.body && res.body.syncs.length) {
        _each(res.body.syncs, function(sync) {
          syncs.push({
            type: 'image',
            url: sync
          })
        })
      }
    })
    return syncs;
  },

};

function getCurrencyType(bidderRequest) {
  return getCurrencyFromBidderRequest(bidderRequest) || 'JPY';
}

function getUrlInfo(refererInfo) {
  let canonicalLink = refererInfo.canonicalUrl;

  if (!canonicalLink) {
    let metaElements = getMetaElements();
    for (let i = 0; i < metaElements.length && !canonicalLink; i++) {
      if (metaElements[i].getAttribute('property') == 'og:url') {
        canonicalLink = metaElements[i].content;
      }
    }
  }

  return {
    canonical_link: canonicalLink,
    // TODO: are these the right refererInfo values?
    url: refererInfo.topmostLocation,
    ref: refererInfo.ref || window.document.referrer,
  };
}

function getMetaElements() {
  try {
    return getWindowTop.document.getElementsByTagName('meta');
  } catch (e) {
    return document.getElementsByTagName('meta');
  }
}

registerBidder(spec);
