// Generador de numeros random
var arr = [], 
    cantidadNumeros = 20,
    hasta = 20; 

function llenarAleatorios(a){
    var v = Math.floor(Math.random() * hasta);
    if(!a.some(function(e){return e == v})){
        a.push(v);
    }
}


// Posicionamiento de las cartas


function posicionarCartas(){
	var arr = [];
	while(arr.length < cantidadNumeros && cantidadNumeros <= hasta){
    llenarAleatorios(arr);
	}
	for(var i=0, x=0;i<20;i++){
		var h = '<div class="cA c'+Math.floor(x)+'"carta="'+Math.floor(x)+'"></div>';
		$('.cP'+arr[i]).append(h);
		$('.cP'+arr[i]+' .cF').attr('onclick','juego('+Math.floor(x)+','+arr[i]+')');
		x = x+0.5;
	}
}
posicionarCartas();

//  Mecanismo del juego


function limpiar(){
	sessionStorage.activo   = undefined;
	sessionStorage.tipo     = undefined;
	sessionStorage.caja     = undefined;
}
limpiar();
sessionStorage.contador = 0;

function terminarJuego(){
	$('.gridJuego').css('display','none');
	$('.gridJuego').css('top','60%');
	$('.gridJuego').css('opacity','0');
	$('.finJuego').css('display','block');
	$('.finJuego').animate({
		opacity: '1',
		top: '50%'
	},400);
}

function juego(e,y){
	var activo      = sessionStorage.activo,
		tipo        = sessionStorage.tipo,
		caja        = sessionStorage.caja,
	    cartaRotarA = $('.cP'+caja),
		cajaA       = $('.caja'+caja),
		caja        = $('.caja'+y),
		cartaRotar  = $('.cP'+y);
	if(activo == 'si'){
		cartaRotar.addClass('rotar');
		if(tipo == e){
			if(sessionStorage.contador == 9){
				limpiar();
				setTimeout(function(){
					cajaA.animate({opacity: '0'},300);
					caja.animate({opacity: '0'},300);
				},500);
				setTimeout(function(){
					terminarJuego();
				},400);
			}else{
				sessionStorage.contador = parseInt(sessionStorage.contador)+1;
				limpiar();
				setTimeout(function(){
					cajaA.animate({opacity: '0'},300);
					caja.animate({opacity: '0'},300);
				},500);
			}	
			
		}else{
			limpiar();
			setTimeout(function(){
				cartaRotar.removeClass('rotar');
				cartaRotarA.removeClass('rotar');
			},500);
		}

	}else{
		sessionStorage.activo   = 'si';
		sessionStorage.tipo     = e;
		sessionStorage.caja     = y;
		cartaRotar.addClass('rotar');
	}
}

// Comenzar juego

function comenzarJuego(){
	$('.presentacion').animate({
		opacity: '0',
		top: '10%'
	},400);
	setTimeout(function(){
		$('.presentacion').css('display','none');
		$('.gridJuego').css('display','flex');
		$('.gridJuego').animate({
			opacity: '1',
			top: '50%'
		},400);
	},450);
}

function volverJuego(){
	$('.finJuego').animate({
		opacity: '0',
		top: '60%'
	},400);
	$('.cA').remove();
	posicionarCartas();
	limpiar();
	sessionStorage.contador = 0;
	setTimeout(function(){
		$('.a').removeClass('rotar');
		$('.gridJuego').css('display','flex');
		$('.caja').css('opacity','1');
		$('.gridJuego').animate({
			opacity: '1',
			top: '50%'
		},400);
	},450);
}