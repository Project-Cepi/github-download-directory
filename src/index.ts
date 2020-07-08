import * as fs       from 'fs';
import { dirname }   from 'path';
import { promisify } from 'util';

import Keyv          from 'keyv';
import { Octokit }   from '@octokit/rest';

const mkdir     = promisify(fs.mkdir);
const writeFile = promisify(fs.writeFile);

const ONE_HOUR_IN_MS = 1000 * 3600;

const defaultCacheOpts = {
	ttl: ONE_HOUR_IN_MS,
	namespace: 'github-download-directory',
};

interface DownloaderOptions {
	cache?: Keyv,
	github?: string,
	sha?: string,
	exportPrefix?: string
}

interface NodeFile {
	sha: string,
	type: string,
	path: string;
}

interface GithubFile {
	path: string,
	contents: Buffer
}

class Downloader {
	/**
	 * Keyv storage for repo
	 */
	public cache: Keyv;

	/**
	 * Octokit instance
	 */
	private octokit: Octokit;
	
	/**
	 * Export prefix for downloading;
	 */
	private exportPrefix: string;

	/**
	 * Sha key
	 */
	private sha: string;

	constructor(options: DownloaderOptions = {}) {
		const cacheOpts = Object.assign({}, defaultCacheOpts, options.cache);

		// Keyv cache options
		this.cache = new Keyv(cacheOpts);

		// Authenticate octokit with token
		this.octokit = new Octokit({ auth: `token ${options.github}` });

		// Set export prefix
		this.exportPrefix = options.exportPrefix || '';

		this.sha = options.sha || 'master';
	}

	private async getTree(owner: string, repo: string) {
		const cacheKey = `${owner}/${repo}#${this.sha}`;

		const cachedTree = await this.cache.get(cacheKey);

		if (cachedTree) {
			return cachedTree;
		}

		const { data: { tree } } = await this.octokit.git.getTree({
			owner,
			repo,
			tree_sha: this.sha,
			recursive: "true",
		});

		await this.cache.set(cacheKey, tree);

		return tree;
	}

	private async fetchFiles(owner: string, repo: string, directory: string): Promise<GithubFile[]> {
		const tree = await this.getTree(owner, repo);

		const files = tree
			.filter((node: NodeFile) => node.path.startsWith(directory) && node.type === 'blob')
			.map(async (node: NodeFile) => {
				const { data } = await this.octokit.git.getBlob({
					owner,
					repo,
					file_sha: node.sha,
				});

				return {
					path: node.path,
					contents: Buffer.from(data.content, data.encoding as BufferEncoding)
				};
			});

		return Promise.all(files);
	}

	private async createDirectories(filepath: string) {
		const dir = dirname(filepath);
		return mkdir(dir, { recursive: true });
	}

	/**
	 * Outputs the github file.
	 * @param file 
	 * @param exportPrefix 
	 */
	private async output(file: GithubFile) {
		await this.createDirectories(this.exportPrefix + file.path);
		await writeFile(this.exportPrefix + file.path, file.contents);
	}

	/**
	 * Downloads a repository with the following options.
	 * @param owner The owner of the repository
	 * @param repo The repository name
	 * @param directory The directory you want to choose. Put empty string for root.
	 * @param options Downloader options
	 */
	public async download(owner: string, repo: string, directory: string) {
		const files = await this.fetchFiles(owner, repo, directory);
		return Promise.all(files.map(file => this.output(file)));
	}
}

export default Downloader;
