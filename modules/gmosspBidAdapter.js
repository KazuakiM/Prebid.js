import { registerBidder } from '../src/adapters/bidderFactory.js';
import * as utils from '../src/utils.js';
import { config } from '../src/config.js';
import { BANNER, NATIVE } from '../src/mediaTypes.js';

const BIDDER_CODE = 'gmossp';
const ENDPOINT = 'https://mabuchi-ad.devel.sp.gmossp-sp.jp/hb/prebid/query.ad';

export const spec = {
  code: BIDDER_CODE,
  supportedMediaTypes: [BANNER, NATIVE],

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
   * @param {validBidRequests[]} - an array of bids
   * @return ServerRequest Info describing the request to the server.
   */
  buildRequests: function (validBidRequests, bidderRequest) {
    const bidRequests = [];

    const url = bidderRequest.refererInfo.referer;
    const cur = getCurrencyType();
    const dnt = utils.getDNT() ? '1' : '0';

    for (let i = 0; i < validBidRequests.length; i++) {
      let queryString = '';

      const request = validBidRequests[i];
      const tid = request.transactionId;
      const bid = request.bidId;
      const ver = '$prebid.version$';
      const sid = utils.getBidIdParameter('sid', request.params);
      const native = utils.getBidIdParameter('native', request.params);

      let eids = [];
      if (bidderRequest && bidderRequest.userId) {
        setUserId(eids, 'liveramp.com', utils.deepAccess(bidderRequest, `userId.idl_env`));
      }

      queryString = utils.tryAppendQueryString(queryString, 'tid', tid);
      queryString = utils.tryAppendQueryString(queryString, 'bid', bid);
      queryString = utils.tryAppendQueryString(queryString, 'ver', ver);
      queryString = utils.tryAppendQueryString(queryString, 'sid', sid);
      queryString = utils.tryAppendQueryString(queryString, 'url', url);
      queryString = utils.tryAppendQueryString(queryString, 'cur', cur);
      queryString = utils.tryAppendQueryString(queryString, 'dnt', dnt);
      queryString = utils.tryAppendQueryString(queryString, 'native', native);
      queryString = utils.tryAppendQueryString(queryString, 'usr', eids);

      bidRequests.push({
        method: 'GET',
        url: ENDPOINT,
        data: queryString
      });
    }
    return bidRequests;
  },

  /**
   * Unpack the response from the server into a list of bids.
   *
   * @param {*} serverResponse A successful response from the server.
   * @return {Bid[]} An array of bids which were nested inside the server.
   */
  interpretResponse: function (bidderResponse, requests) {
    const res = bidderResponse.body;

    if (utils.isEmpty(res)) {
      return [];
    }

    const bid = {
      requestId: res.bid,
      cpm: res.price,
      currency: res.cur,
      width: res.w,
      height: res.h,
      creativeId: res.creativeId,
      netRevenue: true,
      ttl: res.ttl || 300
    };

    if (res.native && res.native.length > 0) {
      // native
      bid.mediaType = NATIVE;
      bid.native = getNativeAd(res.native);
    } else {
      // banner
      bid.mediaType = BANNER;
      bid.ad = getBannerAd(res);
    }

    return [bid];
  },

  /**
   * Register the user sync pixels which should be dropped after the auction.
   *
   * @param {SyncOptions} syncOptions Which user syncs are allowed?
   * @param {ServerResponse[]} serverResponses List of server's responses.
   * @return {UserSync[]} The user syncs which should be dropped.
   */
  getUserSyncs: function(syncOptions, serverResponses) {
    const syncs = [];
    if (!serverResponses.length) {
      return syncs;
    }

    serverResponses.forEach(res => {
      if (syncOptions.pixelEnabled && res.body && res.body.syncs.length) {
        res.body.syncs.forEach(sync => {
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

function getCurrencyType() {
  if (config.getConfig('currency.adServerCurrency')) {
    return config.getConfig('currency.adServerCurrency');
  }
  return 'JPY';
}

function setUserId(eids, source, value) {
  if (utils.isStr(value)) {
    eids.push({
      source: source,
      uids: [{
        id: value
      }]
    });
  }
}

function getBannerAd(res) {
  try {
    res.imps.forEach(impTracker => {
      const tracker = utils.createTrackPixelHtml(impTracker);
      res.ad += tracker;
    });
  } catch (error) {
    utils.logError('Error appending tracking pixel', error);
  }

  return res.ad
}

function getNativeAd(resNative) {
  if (!resNative.assets.length) {
    return {};
  }

  let native = {};
  resNative.assets.forEach(asset => {
    switch (asset.id) {
      case 0:
        native.title = asset.title.text;
        break;

      case 1:
        native.body = asset.data.value;
        break;

      case 2:
        native.sponsoredBy = asset.data.value;
        break;

      case 3:
        native.icon = {
          url: asset.img.url,
          width: asset.img.w,
          height: asset.img.h,
        };
        break;

      case 4:
        native.image = {
          url: asset.img.url,
          width: asset.img.w,
          height: asset.img.h,
        };
        break;
    }
  });

  native.clickUrl = resNative.link.url;
  native.impressionTrackers = resNative.imptrackers || [];
  native.privacyLink = resNative.privacy || '';
  native.privacyIcon = resNative.privacyIcon || '';

  return native;
}

registerBidder(spec);
