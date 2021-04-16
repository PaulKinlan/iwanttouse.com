class Browser {
  constructor(key, agent) {
    this.agent = agent;
    this.key = key;
    this._totalShare = Object.values(agent.usage_global).reduce(
      (memo, num) => memo + num,
      0
    );
  }

  get browser() {
    return this.agent.browser;
  }

  get share() {
    return this.agent.share;
  }

  get type() {
    return this.agent.type;
  }

  get versionKeys() {
    let versions = [];
    for (let v in this.agent.versions) {
      if (!!this.agent.versions[v]) {
        versions.push(this.key + "+" + this.agent.versions[v]);
      }
    }
    return versions;
  }

  get totalShare() {
    return this._totalShare;
  }

  getVersionShare(version) {
    return this.agent.usage_global[version] || 0;
  }
}

class Browsers {
  constructor() {
    this._agents = {};
    this._features = {};
  }

  get features() {
    return this._features;
  }

  addBrowser(a, agent) {
    this._agents[a] = new Browser(a, agent);
  }

  getBrowser(key) {
    var ua = key.split("+");
    var agent = this._agents[ua[0]];
    return {
      key: key,
      version: ua[1],
      type: agent.type,
      name: agent.browser,
      browserShare: agent.getVersionShare(ua[1]),
    };
  }

  addFeature(feature, versions) {
    this._features[feature] = versions;
  }

  getByFeature(features, states) {
    let output = [];
    if (!!features == false || features.length === 0) {
      // get every single browser and version
      let agents = [];
      for (let a in this._agents) {
        agents = agents.concat(this._agents[a].versionKeys);
      }
      output.push(agents);
    } else {
      for (let f = 0; f < features.length; f++) {
        output.push([]);
        let feat = features[f];
        let feature = this._features[feat];
        for (var b in feature.stats) {
          for (var v in feature.stats[b]) {
            var present = feature.stats[b][v];
            if (states.indexOf(present) > -1) {
              output[f].push(b + "+" + v);
            }
          }
        }
      }
    }

    let browser_vers = _.intersection.apply(this, output);
    let self = this;
    let aggregates = _.groupBy(browser_vers, function (i) {
      return self.getBrowser(i).name;
    });

    return _.map(browser_vers, function (i) {
      var b = self.getBrowser(i);
      b.versions = _.map(aggregates[b.name], function (r) {
        return r.split("+")[1];
      });
      b._versions = _.map(aggregates[b.name], function (r) {
        return parseInt(r.split("+")[1].split("-")[0]);
      });
      return b;
    });
  }

  browsersByFeature(features, states) {
    return this.featuresByProperty(features, states, "name");
  }

  typesByFeature(features, states) {
    return this.featuresByProperty(features, states, "type");
  }

  featuresByProperty(features, states, property) {
    var supportedBy = this.getByFeature(features, states);
    return _.map(
      _.groupBy(supportedBy, function (i) {
        return i[property];
      }),
      function (i) {
        return {
          name: i[0][property],
          versions: i[0].versions,
          since: _.min(i[0]._versions),
          share: _.reduce(
            i,
            function (memo, r) {
              return memo + r.browserShare;
            },
            0
          ),
        };
      }
    );
  }

  getFeature(featureName) {
    return this._features[featureName];
  }
}
class BrowserStats {
  // load the Browser stats, returns a promise.
  static load(type) {
    return fetch("data.json")
      .then(response => response.json())
      .then(data => {
        let browsers = new Browsers();
        let validAgents = {};
        for (let a in data.agents) {
          if (type == "all" || type == data.agents[a].type) {
            browsers.addBrowser(a, data.agents[a]);
            validAgents[a] = true;
          }
        }

        for (let i in data.data) {
          // Remove agents that are not part of the viewed set.
          let feature = data.data[i];
          for (let a in feature.stats) {
            if (!!validAgents[a] == false) {
              feature.stats[a] = undefined;
            }
          }
          browsers.addFeature(i, feature);
        }
        
        return browsers;
      });
  }
}
