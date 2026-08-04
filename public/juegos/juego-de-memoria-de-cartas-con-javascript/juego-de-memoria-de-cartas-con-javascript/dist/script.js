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

// Variables de estado del juego (soluciona corrupcion por clics rapidos o sessionStorage)
var gameState = {
    activo: false,
    tipo: null,
    caja: null,
    contador: 0,
    bloqueado: false
};

function posicionarCartas(){
    var arr = [];
    while(arr.length < cantidadNumeros && cantidadNumeros <= hasta){
        llenarAleatorios(arr);
    }
    for(var i=0, x=0; i<20; i++){
        var h = '<div class="cA c'+Math.floor(x)+'" carta="'+Math.floor(x)+'"></div>';
        $('.cP'+arr[i]).html(h);
        $('.cP'+arr[i]+' .cF').attr('onclick','juego('+Math.floor(x)+','+arr[i]+')');
        x = x+0.5;
    }
}
posicionarCartas();

function limpiar(){
    gameState.activo = false;
    gameState.tipo = null;
    gameState.caja = null;
    gameState.bloqueado = false;
}
limpiar();
gameState.contador = 0;

function terminarJuego(){
    $('.gridJuego').css('display','none');
    $('.gridJuego').css('top','60%');
    $('.gridJuego').css('opacity','0');
    $('.finJuego').css('display','block');
    $('.finJuego').animate({
        opacity: '1',
        top: '50%'
    }, 400);
}

function juego(e, y){
    // Evitar romper el mecanismo por doble clic en la misma carta o clics rapidos
    if (gameState.bloqueado) return;
    if (gameState.activo && gameState.caja === y) return;

    var cartaRotar = $('.cP'+y),
        caja = $('.caja'+y);

    if (gameState.activo){
        var tipo = gameState.tipo,
            cajaIndexA = gameState.caja,
            cartaRotarA = $('.cP'+cajaIndexA),
            cajaA = $('.caja'+cajaIndexA);

        cartaRotar.addClass('rotar');
        gameState.bloqueado = true; // Bloquear nuevas selecciones hasta voltear

        if (tipo === e){
            if (gameState.contador >= 9){
                limpiar();
                setTimeout(function(){
                    cajaA.animate({opacity: '0'}, 300);
                    caja.animate({opacity: '0'}, 300);
                }, 500);
                setTimeout(function(){
                    terminarJuego();
                }, 400);
            } else {
                gameState.contador += 1;
                limpiar();
                setTimeout(function(){
                    cajaA.animate({opacity: '0'}, 300);
                    caja.animate({opacity: '0'}, 300);
                }, 500);
            }
        } else {
            limpiar();
            gameState.bloqueado = true;
            setTimeout(function(){
                cartaRotar.removeClass('rotar');
                cartaRotarA.removeClass('rotar');
                gameState.bloqueado = false;
            }, 600);
        }
    } else {
        gameState.activo = true;
        gameState.tipo = e;
        gameState.caja = y;
        cartaRotar.addClass('rotar');
    }
}

function comenzarJuego(){
    $('.presentacion').animate({
        opacity: '0',
        top: '10%'
    }, 400);
    setTimeout(function(){
        $('.presentacion').css('display','none');
        $('.gridJuego').css('display','flex');
        $('.gridJuego').animate({
            opacity: '1',
            top: '50%'
        }, 400);
    }, 450);
}

function volverJuego(){
    $('.finJuego').animate({
        opacity: '0',
        top: '60%'
    }, 400);
    $('.cA').remove();
    posicionarCartas();
    limpiar();
    gameState.contador = 0;
    setTimeout(function(){
        $('.a').removeClass('rotar');
        $('.gridJuego').css('display','flex');
        $('.caja').css('opacity','1');
        $('.gridJuego').animate({
            opacity: '1',
            top: '50%'
        }, 400);
    }, 450);
}