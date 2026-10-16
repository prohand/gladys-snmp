# SNMP

Esta integración lee sus equipos de red por **SNMP** — switches, routers,
puntos de acceso Wi-Fi, NAS, servidores, SAI, PDU, impresoras — y convierte
cada uno en un dispositivo Gladys: si está accesible, con qué rapidez
responde, cuánto tiempo lleva desde su último reinicio, y los valores que
elija (tráfico de los puertos, CPU, discos, batería, cualquier OID).

Todo se queda en su red local: Gladys consulta sus equipos directamente
(puerto UDP 161), nada pasa por una nube.

## Antes de empezar

Active SNMP en cada equipo:

- **SNMP v2c** con una **comunidad de solo lectura** es lo más sencillo. La
  comunidad es una contraseña: elija la suya en lugar de `public`.
- **SNMP v3** cifra las peticiones: cree un usuario con autenticación SHA y
  cifrado AES (`authPriv`) si el equipo lo ofrece.
- Autorice la dirección de su servidor Gladys si el equipo filtra quién puede
  consultarlo.

Dónde encontrarlo normalmente: Synology _Panel de control → Terminal y SNMP_,
QNAP _Servicios de red y archivos → SNMP_, UniFi _Configuración → Sistema →
SNMP_, MikroTik _IP → SNMP_, un servidor Linux `snmpd`
(`/etc/snmp/snmpd.conf`), una tarjeta de red Eaton o APC _Network → SNMP_.

## Descubrimiento automático

Lo más sencillo: deje que Gladys encuentre sus equipos.

1. En **Configuración**, indique su **comunidad** (sección _Acceso SNMP_) si
   no es `public`, y guarde.
2. Abra la pestaña **Descubrimiento** y pulse **Escanear**.
3. Gladys envía una petición SNMP (lectura de `sysName`) en broadcast por su
   red local, puerto UDP 161. Cada equipo que responde aparece, con su nombre
   SNMP.
4. Pulse **Crear** en los que quiera seguir.

Los perfiles se eligen solos: `host` si el equipo tiene HOST-RESOURCES (CPU,
memoria, discos), `ups` si tiene UPS-MIB. Las interfaces y los OID
personalizados se siguen declarando en la lista (ver más abajo).

Conviene saber:

- El escaneo usa SNMP v2c (v1 si eligió v1) y la comunidad de la
  configuración. Se envía en broadcast a toda la red local: en v1/v2c viaja
  en claro de todos modos.
- Solo cubre el puerto 161 y la red local del servidor Gladys. Un equipo
  **solo en SNMP v3**, en otro puerto o detrás de un router se declara a
  mano, en la lista de abajo.
- Algunos equipos no responden a las peticiones en broadcast: añádalos
  también a mano.
- Los equipos descubiertos no necesitan estar en la lista: Gladys los guarda.
  Elimine el dispositivo en Gladys para dejar de seguirlo.
- El escaneo necesita un Gladys con descubrimiento de red (escaneo
  «activo»): en una versión más antigua no encuentra nada y el registro lo
  indica.

## Configuración

Abra la pestaña **Configuración** de la integración.

### Agentes SNMP

Liste los equipos a leer, separados por comas:

```
host[:puerto];nombre;perfiles
```

Por ejemplo:

```
192.168.1.1;Router, 192.168.1.10;NAS;host, 192.168.1.20;SAI;ups
```

- `host` — una dirección IP o un nombre de host. Un puerto distinto de 161 va
  después de dos puntos (`192.168.1.2:1161`), una dirección IPv6 entre
  corchetes (`[fe80::1]:161`).
- `nombre` — el nombre del dispositivo en Gladys (el host si se omite).
- `perfiles` — qué leer además de lo básico, unidos con `+` (`host+ups`):
  - `host` — carga de CPU, memoria usada, disco más lleno
    (HOST-RESOURCES-MIB: Linux, Windows, Synology, QNAP…);
  - `ups` — carga de la batería, autonomía, batería baja, red eléctrica
    presente, tensión de entrada, carga y potencia de salida (UPS-MIB:
    Eaton, APC con tarjeta de red, la mayoría de tarjetas de SAI);
  - `interfaces` — vea la forma JSON más abajo.

### La forma JSON

Para interfaces, OID personalizados o credenciales distintas de un equipo a
otro, pegue en su lugar una lista JSON:

```json
[
  {
    "name": "Switch oficina",
    "host": "192.168.1.2",
    "interfaces": [1, 2, "ge-0/0/24"]
  },
  {
    "id": "nas",
    "name": "NAS",
    "host": "192.168.1.10",
    "profiles": ["host"],
    "refresh": 300,
    "oids": [
      {
        "oid": "1.3.6.1.4.1.6574.1.2.0",
        "key": "temperature",
        "name": "Temperatura del sistema",
        "category": "temperature-sensor",
        "type": "decimal",
        "unit": "celsius"
      }
    ]
  },
  {
    "name": "PDU",
    "host": "192.168.1.30",
    "community": "mi-comunidad-escritura",
    "oids": [
      {
        "oid": "1.3.6.1.4.1.318.1.1.12.3.3.1.1.4.1",
        "key": "outlet1",
        "name": "Toma 1",
        "writable": true,
        "on": 1,
        "off": 2
      }
    ]
  }
]
```

Campos de un agente:

| Campo                                                                       | Significado                                                                                                                                    |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `host`                                                                      | dirección IP o nombre de host (obligatorio)                                                                                                    |
| `port`                                                                      | puerto UDP, 161 por defecto                                                                                                                    |
| `name`                                                                      | nombre en Gladys                                                                                                                               |
| `id`                                                                        | lo que Gladys usa para identificar el dispositivo. Rellénelo si la dirección IP puede cambiar: cambiar `id` o `host` crea un dispositivo nuevo |
| `version`                                                                   | `1`, `2c` o `3` (la de la configuración por defecto)                                                                                           |
| `community`                                                                 | comunidad v1/v2c de este equipo                                                                                                                |
| `user`, `auth_protocol`, `auth_key`, `priv_protocol`, `priv_key`, `context` | ajustes SNMPv3 de este equipo                                                                                                                  |
| `profiles`                                                                  | `host`, `ups`, `interfaces`                                                                                                                    |
| `interfaces`                                                                | las interfaces a seguir, por índice o por nombre (16 como máximo)                                                                              |
| `oids`                                                                      | sus propios OID, vea más abajo                                                                                                                 |
| `refresh`                                                                   | intervalo de actualización de este equipo, en segundos (60 como mínimo)                                                                        |

**Interfaces.** Cada interfaz da tres funciones: enlace (1 = activo), tasa de
entrada y tasa de salida en kbit/s. Use **Listar las interfaces** (más abajo)
para encontrar el índice o el nombre a escribir. Las tasas se calculan entre
dos consultas: aparecen a partir de la segunda.

**OID personalizados.** Solo `oid` es obligatorio: el valor se muestra como un
número simple. Añada:

- `category`, `type`, `unit` — la función de Gladys (p. ej.
  `temperature-sensor` / `decimal` / `celsius`, `energy-sensor` / `power` /
  `watt`); `text` / `text` muestra un texto;
- `scale` — multiplica el valor bruto (`0.1` para décimas de grado);
- `on` / `off` — los valores brutos que significan encendido y apagado, para
  una función binaria;
- `writable: true` — lo convierte en un interruptor que Gladys puede controlar
  (un SET SNMP con `on` u `off`); `set_type` es `integer` (por defecto),
  `unsigned` o `string`. Necesita una comunidad de **lectura-escritura** solo
  en ese equipo;
- `key` — el nombre estable de la función (por defecto, construido a partir
  del OID);
- `min` / `max` — el rango de la función.

### Acceso SNMP

- **Versión SNMP** — la usa cada agente que no fija la suya.
- **Comunidad** — v1/v2c, `public` si se deja vacía.
- **SNMPv3** — usuario, protocolo y clave de autenticación, protocolo y clave
  de cifrado. El nivel de seguridad depende de lo que rellene: solo un usuario
  es `noAuthNoPriv`, con una clave de autenticación `authNoPriv`, con ambas
  claves `authPriv`.

### Consulta

- **Intervalo de actualización** — con qué frecuencia se lee cada equipo, 60
  segundos como mínimo (Gladys consulta como mucho una vez por minuto). Cada
  valor va al historial: en una red grande, mejor 300 segundos.
- **Tiempo de espera** y **Reintentos** — cuánto tiempo y cuántas veces se
  espera una respuesta antes de declarar un equipo inaccesible.
- **Registros detallados** — registra cada fallo SNMP, para entender un
  equipo que no responde. Las comunidades y las claves nunca se registran.

Guarde: los dispositivos aparecen en la pestaña **Descubrimiento**, listos
para añadirse.

## Lo que obtiene

Cada dispositivo tiene:

| Función             | Significado                                                    |
| ------------------- | -------------------------------------------------------------- |
| Accesible           | 1 cuando el equipo responde por SNMP, 0 cuando deja de hacerlo |
| Tiempo de respuesta | tiempo de respuesta, en milisegundos                           |
| Tiempo activo       | días desde el (re)inicio del equipo                            |

La tarjeta del dispositivo muestra además una insignia **local**, o
**unreachable** cuando el equipo deja de responder.

## Acciones

- **Probar la conexión** — lee todos los equipos ahora y dice, para cada uno,
  si respondió, con qué rapidez y su nombre de sistema. Los errores de la
  lista de agentes también aparecen aquí.
- **Listar las interfaces** — las interfaces de un equipo: índice, nombre y ▲
  para las que tienen enlace. Copie el índice o el nombre en su lista
  `interfaces`.
- **Recorrer un OID** — los objetos bajo un OID (20 líneas por defecto), para
  encontrar el que añadir a `oids`. `1.3.6.1.2.1.1` es el grupo de sistema,
  `1.3.6.1.4.1` las MIB de los fabricantes.

## Escenas y panel (Gladys 5.1)

### Disparadores

- **Un agente SNMP deja de responder** — un equipo que respondía no ha
  respondido a la última consulta. Variables: `device_name`, `host`, `error`.
- **Un agente SNMP vuelve a responder** — variables: `device_name`, `host`,
  `downtime_minutes`.
- **Una interfaz de red se activa o se cae** — filtro en activa, caída o
  ambas. Variables: `device_name`, `interface`, `status`.

Se disparan una vez por cambio, nunca en cada consulta. Un equipo que ya está
apagado cuando Gladys arranca no dispara nada.

Para un umbral (un disco por encima del 90 %, una batería por debajo del 30 %),
use el disparador habitual de Gladys **valor de un dispositivo** sobre la
función.

### Acciones

- **Leer un valor SNMP** — un OID de un equipo. Salidas: `success`, `value`
  (texto), `number`, `error`.
- **Escribir un valor SNMP** — un OID, como entero, sin signo o texto: apagar
  una toma de una PDU, reiniciar un puerto PoE… Salidas: `success`, `error`.
- **Consultar un agente SNMP ahora** — lee un equipo sin esperar. Salidas:
  `reachable`, `response_time`.

Una acción que falla nunca detiene la escena: compruebe `success` (o
`reachable`) en una condición justo después.

### Widget

El widget **Agentes SNMP** muestra cuántos equipos responden, una línea por
equipo con su tiempo de respuesta y un botón **Consultar ya**. Elija un equipo
en sus ajustes para ver también sus valores en directo (tiempo de respuesta,
tiempo activo, CPU, memoria, batería…).

## Solución de problemas

- **El escaneo no encuentra nada** — compruebe la comunidad y la versión en
  _Acceso SNMP_, y que el equipo está en la misma red local que el servidor
  Gladys. Un equipo que ignora el broadcast, o solo en SNMP v3, se declara a
  mano.
- **Un equipo sigue inaccesible** — compruebe que SNMP está activado, que la
  comunidad (o el usuario y las claves v3) es correcta y que el equipo acepta
  peticiones desde la dirección de su servidor Gladys. Active los **Registros
  detallados** y ejecute **Probar la conexión**.
- **Accesible, pero un perfil no muestra nada** — el equipo no tiene esa MIB
  (muchos switches no tienen HOST-RESOURCES). Use **Recorrer un OID** para ver
  lo que ofrece y añada OID personalizados.
- **No se encuentra un nombre de interfaz** — ejecute **Listar las
  interfaces** y copie el nombre exactamente, o use el índice.
- **Un interruptor no conmuta** — la comunidad de ese equipo debe ser de
  lectura-escritura, y `on` / `off` deben ser los valores que espera la MIB del
  fabricante.
