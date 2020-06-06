"use strict";

var fs = require("fs");
var { dirname } = require("path");
var { promisify } = require("util");

var Keyv = require("keyv");
var { Octokit } = require("@octokit/rest");

var mkdir = promisify(fs.mkdir);
var writeFile = promisify(fs.writeFile);

var ONE_HOUR_IN_MS = 1000 * 3600;

var defaultCacheOpts = {
  ttl: ONE_HOUR_IN_MS,
  namespace: "github-download-directory",
};

async function createDirectories(filepath) {
  var dir = dirname(filepath);
  return mkdir(dir, { recursive: true });
}

async function output(file) {
  await createDirectories(file.path);
  await writeFile(file.path, file.contents);
}

class Downloader {
  constructor(options = {}) {
    var cacheOpts = Object.assign({}, defaultCacheOpts, options.cache);

    this.cache = new Keyv(cacheOpts);

    this._octokit = new Octokit(options.github);
  }

  async getTree(owner, repo, options = {}) {
    var sha = options.sha || "master";
    var cacheKey = `${owner}/${repo}#${sha}`;

    var cachedTree = await this.cache.get(cacheKey);
    if (cachedTree) {
      return cachedTree;
    }

    var {
      data: { tree },
    } = await this._octokit.git.getTree({
      owner,
      repo,
      tree_sha: sha,
      recursive: true,
    });

    await this.cache.set(cacheKey, tree);

    if (typeof this.cache.save === "function") {
      await this.cache.save();
    }

    return tree;
  }

  async fetchFiles(owner, repo, directory, options = {}) {
    var tree = await this.getTree(owner, repo, options);

    var files = tree
      .filter((node) => node.path.startsWith(directory) && node.type === "blob")
      .map(async (node) => {
        var { data } = await this._octokit.git.getBlob({
          owner,
          repo,
          file_sha: node.sha,
        });
        return {
          path: node.path,
          contents: Buffer.from(data.content, data.encoding),
        };
      });

    return Promise.all(files);
  }

  async download(owner, repo, directory, options = {}) {
    var files = await this.fetchFiles(owner, repo, directory, options);
    return Promise.all(files.map(output));
  }
}

module.exports = new Downloader();
module.exports.Downloader = Downloader;
