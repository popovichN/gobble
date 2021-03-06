var fs = require( 'graceful-fs' ),
	path = require( 'path' ),
	sander = require( 'sander' ),
	Node = require( './Node' ),
	mapSeries = require( 'promise-map-series' ),
	Promise = require( 'promo' ).Promise,

	session = require( './session' ),
	merge = require( './file/merge' ),
	assign = require( './utils/assign' ),
	uid = require( './utils/uid' );

var Merger = function ( inputs, options ) {
	var node = this;

	node.inputs = inputs;
	node._readyStates = inputs.map( function () { return true; });
	node.errors = [];

	node.callbacks = [];
	node.inspectTargets = [];

	node.id = uid( ( options && options.id ) || 'merge' );

	node.counter = 1;
};

Merger.prototype = assign( Object.create( Node.prototype ), {
	ready: function () {
		var node = this, outputdir;

		if ( !node._ready ) {
			outputdir = path.resolve( session.config.gobbledir, node.id, '' + node.counter++ );
			node._ready = sander.mkdir( outputdir ).then( function () {
				return new Promise( function ( fulfil, reject ) {
					var start, inputdirs = [];

					node._abort = function ( err ) {
						reject( err );
						node._ready = null;
					};


					mapSeries( node.inputs, function ( input, i ) {
						return input.ready().then( function ( inputdir ) {
							inputdirs[i] = inputdir;
						});
					}).then( function () {
						start = Date.now();

						return mapSeries( inputdirs, function ( inputdir ) {
							return merge( inputdir ).to( outputdir );
						});
					}).then( function () {
						session.info( '%s finished in %sms', node.id, Date.now() - start );
						fulfil( outputdir );
					}).catch( reject );
				});
			});
		}

		return node._ready;
	},

	watch: function ( callback ) {
		var node = this, relay, readyStates = node._readyStates;

		node.callbacks.push( callback );

		// If this node isn't already in watching mode, it needs to be...
		if ( !node._watchers ) {
			relay = function ( outputdir ) {
				node._relay( null, outputdir );
			};

			node._watchers = node.inputs.map( function ( input, i ) {
				return input.watch( function ( err, dir ) {
					if ( err ) {
						readyStates[i] = false;
						node._relay( err );
					}

					node._abort( err || { code: 'BUILD_INVALIDATED' });

					if ( dir ) {
						readyStates[i] = true;

						// Only proceed if all inputs are good to go
						if ( readyStates.every( Boolean ) ) {
							node.ready().then( relay );
						}
					}
				});
			});
		}

		return {
			cancel: function () {
				node.unwatch( callback );
			}
		};
	},

	unwatch: function ( callback ) {
		var callbacks = this.callbacks, index = callbacks.indexOf( callback );

		if ( ~callbacks.indexOf( callback ) ) {
			callbacks.splice( index, 1 );

			if ( !callbacks.length && this._watchers ) {
				this._watchers.forEach( function ( watcher ) {
					watcher.cancel();
				});
				this._watchers = null;
			}
		}
	},

	_findCreator: function ( filename ) {
		var i = this.inputs.length, node;
		while ( i-- ) {
			node = this.inputs[i];
			if ( node._findCreator( filename ) ) {
				return node;
			}
		}

		return null;
	},

	_cleanup: function () {
		var node = this, dir = path.join( session.config.gobbledir, node.id );

		// Remove everything except the last successful output dir.
		// Use readdirSync to eliminate race conditions
		fs.readdirSync( dir ).file( function ( file ) {
			return file != node.counter && file !== '.cache';
		}).forEach( function ( dirpath ) {
			sander.rimraf( dirpath );
		});

		node.inputs.forEach( function ( input ) {
			input._cleanup();
		});
	}
});

Merger.prototype.constructor = Merger;
module.exports = Merger;
