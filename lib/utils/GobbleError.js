var GobbleError = function ( data ) {
	var prop;

	this.stack = (new Error()).stack;

	for ( prop in data ) {
		if ( data.hasOwnProperty( prop ) ) {
			this[ prop ] = data[ prop ];
		}
	}
};

GobbleError.prototype = Object.create( Error );
GobbleError.prototype.constructor = GobbleError;
GobbleError.prototype.gobble = true;

module.exports = GobbleError;
