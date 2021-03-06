var fs = require( 'graceful-fs' ),
	path = require( 'path' ),
	sander = require( 'sander' ),
	chokidar = require( 'graceful-chokidar' ),
	debounce = require( 'debounce' ),
	Promise = require( 'promo' ).Promise,
	assign = require( './utils/assign' ),
	Node = require( './Node' ),
	session = require( './session' );

var Source = function ( dir, options ) {
	var node = this;

	node.dir = path.resolve( dir );
	node.callbacks = [];
	node.inspectTargets = [];

	sander.exists( node.dir ).then( function ( exists ) {
		if ( !exists ) {
			session.warn( 'The \'%s\' directory does not exist!', dir );
		}
	});

	node.static = options && options.static;
	node._ready = Promise.resolve( node.dir );
};

Source.prototype = assign( Object.create( Node.prototype ), {

	ready: function () {
		return this._ready;
	},

	watch: function ( callback ) {
		var node = this, relay, options, changes = [];

		node.callbacks.push( callback );

		// If this node isn't already in watching mode, it needs to be...
		if ( !node._watcher && !node.static ) {
			relay = debounce(function () {
				session.info( summariseChanges( changes ) );
				node._relay({ gobble: 'INVALIDATE', changes: changes }, node.dir );
				changes = [];
			}, 100 );

			options = {
				persistent: true,
				ignoreInitial: true,
				useFsEvents: false // see https://github.com/paulmillr/chokidar/issues/146
			};

			node._watcher = chokidar.watch( node.dir, options );

			[ 'add', 'change', 'unlink' ].forEach( function ( type ) {
				node._watcher.on( type, function ( path ) {
					changes.push({ type: type, path: path });
					relay();
				});
			});

			node._watcher.on( 'error', function ( err ) {
				if ( err.code === 'EMFILE' ) {
					session.error( 'too many files open (EMFILE). Consider raising the limit with e.g. ' + 'ulimit -n 1024'.cyan + '. See ' + 'http://bit.ly/EMFILE'.magenta + ' for more information' );
				}

				else {
					session.error( 'error while watching \'%s\': %s' , node.dir, err.message || err );
				}
			});

			this.watching = true;
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

			if ( !callbacks.length && this._watcher ) {
				this._watcher.close();
				this._watcher = null;
			}
		}
	},

	_findCreator: function ( filename ) {
		try {
			fs.statSync( filename );
			return this;
		} catch ( err ) {
			return null;
		}
	},

	_cleanup: function () {} // noop
});

Source.prototype.constructor = Source;
module.exports = Source;

function summariseChanges ( changes ) {
	var summary = {
		add: 0,
		unlink: 0,
		change: 0
	}, report = [];

	changes.forEach( function ( change ) {
		summary[ change.type ] += 1;
	});

	if ( summary.add ) {
		report.push( summary.add + ( summary.add === 1 ? ' file' : ' files' ) + ' added' );
	}

	if ( summary.change ) {
		report.push( summary.change + ( summary.change === 1 ? ' file' : ' files' ) + ' changed' );
	}

	if ( summary.unlink ) {
		report.push( summary.unlink + ( summary.unlink === 1 ? ' file' : ' files' ) + ' removed' );
	}

	return report.join( ', ' );
}
