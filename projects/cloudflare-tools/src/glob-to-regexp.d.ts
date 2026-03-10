declare module "glob-to-regexp" {
	function globToRegExp(glob: string, opts?: { extended?: boolean; globstar?: boolean; flags?: string }): RegExp;
	export default globToRegExp;
}
