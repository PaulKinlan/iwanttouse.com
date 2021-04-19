const intersectionOf = (arrays) => {
  if (arrays.length == 1) return [...new Set(arrays[0])];
  if (arrays.length < 2) throw "not enough inputs";
  
  const output = new Set();
  for(let i = 1; i < arrays.length; i++) {
    for(let item of arrays[i-1]) {
      if(arrays[i].indexOf(item) > -1) output.add(item);
    }
  }

  return [...output];
};

const groupBy = (array, func) => {
  const output = {};
  for(let item of array) {
    const key = func(item);
    if (key in output == false) {
      output[key] = []; 
    }
    output[key].push(item);
  }
  return output;
}

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
      for (let featureName of features) {
        output[featureName] = [];
        let feature = this._features[featureName];
        for (let b in feature.stats) {
          for (let v in feature.stats[b]) {
            let present = feature.stats[b][v];
            if (states.indexOf(present) > -1) {
              output[featureName].push(b + "+" + v);
            }
          }
        }
      }
    }

    let browser_vers = intersectionOf(Object.values(output));
    let aggregates = groupBy(browser_vers, (i) => {
      return this.getBrowser(i).name;
    });

    return browser_vers.map((i) => {
      var b = this.getBrowser(i);
      b.versions = aggregates[b.name].map((r) => {
        return r.split("+")[1];
      });
      b._versions = aggregates[b.name].map((r) => {
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
    let supportedBy = this.getByFeature(features, states);
    let browserSupport = groupBy(supportedBy, (i) => {
      return i[property];
    });
    return Object.values(browserSupport).map(
       (i) => ({
          name: i[0][property],
          versions: i[0].versions,
          since: Math.min(...(i[0]._versions)), // sometimes the version is not a number..
          share: i.reduce((memo, r) => memo + r.browserShare, 0),
        })
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
