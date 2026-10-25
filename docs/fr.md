# SNMP

Cette intégration lit vos équipements réseau en **SNMP** — switchs, routeurs,
bornes Wi-Fi, NAS, serveurs, onduleurs, PDU, imprimantes — et fait de chacun
un appareil Gladys : est-il joignable, en combien de temps il répond, depuis
quand il a redémarré, et les valeurs que vous choisissez (trafic des ports,
CPU, disques, batterie, n'importe quel OID).

Tout reste sur votre réseau local : Gladys interroge vos équipements
directement (port UDP 161), rien ne passe par un cloud.

## Avant de commencer

Cette intégration nécessite **Gladys 5.3.0 ou plus récent**.

Sur chaque équipement, activez SNMP :

- **SNMP v2c** avec une **communauté en lecture seule**, c'est le plus simple.
  La communauté est un mot de passe : choisissez la vôtre plutôt que `public`.
- **SNMP v3** chiffre les requêtes : créez un utilisateur avec
  authentification SHA et chiffrement AES (`authPriv`) si l'équipement le
  propose.
- Autorisez l'adresse de votre serveur Gladys si l'équipement filtre qui peut
  l'interroger.

Où le trouver le plus souvent : Synology _Panneau de configuration →
Terminal & SNMP_, QNAP _Services réseau et fichiers → SNMP_, UniFi
_Paramètres → Système → SNMP_, MikroTik _IP → SNMP_, un serveur Linux
`snmpd` (`/etc/snmp/snmpd.conf`), une carte réseau Eaton ou APC
_Network → SNMP_.

## Découverte automatique

Le plus simple : laissez Gladys trouver vos équipements.

1. Dans **Configuration**, indiquez votre **communauté** (section _Accès
   SNMP_) si ce n'est pas `public`, et enregistrez.
2. Ouvrez l'onglet **Découverte** et cliquez sur **Scanner**.
3. Gladys envoie une requête SNMP (lecture de `sysName`) en broadcast sur
   votre réseau local, port UDP 161. Chaque équipement qui répond apparaît,
   avec son nom SNMP.
4. Cliquez sur **Créer** pour ceux que vous voulez suivre.

Les profils sont choisis tout seuls : `host` si l'équipement a
HOST-RESOURCES (CPU, mémoire, disques), `ups` s'il a UPS-MIB. Les
interfaces et les OID personnalisés se déclarent toujours dans la liste
(voir plus bas).

Bon à savoir :

- Le scan utilise SNMP v2c (v1 si vous avez choisi v1) et la communauté de la
  configuration. Elle part en broadcast sur tout le réseau local : en v1/v2c
  elle circule de toute façon en clair.
- Seuls le port 161 et le réseau local du serveur Gladys sont couverts. Un
  équipement **uniquement en SNMP v3**, sur un autre port ou derrière un
  routeur se déclare à la main, dans la liste ci-dessous.
- Certains équipements ne répondent pas aux requêtes en broadcast : ajoutez-les
  aussi à la main.
- Les équipements découverts n'ont pas besoin d'être dans la liste : Gladys
  les garde. Supprimez l'appareil dans Gladys pour arrêter de le suivre.
- Le scan demande Gladys avec la découverte réseau (scan « actif ») : sur une
  version plus ancienne, il ne trouve rien et le journal le dit.

## Configuration

Ouvrez l'onglet **Configuration** de l'intégration.

### Agents SNMP

Listez les équipements à lire, séparés par des virgules :

```
hôte[:port];nom;profils
```

Par exemple :

```
192.168.1.1;Routeur, 192.168.1.10;NAS;host, 192.168.1.20;Onduleur;ups
```

- `hôte` — une adresse IP ou un nom d'hôte. Un port autre que 161 se met
  après deux-points (`192.168.1.2:1161`), une adresse IPv6 entre crochets
  (`[fe80::1]:161`).
- `nom` — le nom de l'appareil dans Gladys (l'hôte s'il est omis).
- `profils` — ce qu'il faut lire en plus de la base, reliés par `+`
  (`host+ups`) :
  - `host` — charge CPU, mémoire utilisée, disque le plus plein
    (HOST-RESOURCES-MIB : Linux, Windows, Synology, QNAP…) ;
  - `ups` — charge de la batterie, autonomie, batterie faible, présence
    secteur, tension d'entrée, charge et puissance de sortie (UPS-MIB :
    Eaton, APC avec carte réseau, la plupart des cartes d'onduleur) ;
  - `interfaces` — voir la forme JSON ci-dessous.

### La forme JSON

Pour les interfaces, des OID personnalisés ou des identifiants différents
d'un équipement à l'autre, collez plutôt une liste JSON :

```json
[
  {
    "name": "Switch bureau",
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
        "name": "Température système",
        "category": "temperature-sensor",
        "type": "decimal",
        "unit": "celsius"
      }
    ]
  },
  {
    "name": "PDU",
    "host": "192.168.1.30",
    "community": "ma-communaute-ecriture",
    "oids": [
      {
        "oid": "1.3.6.1.4.1.318.1.1.12.3.3.1.1.4.1",
        "key": "outlet1",
        "name": "Prise 1",
        "writable": true,
        "on": 1,
        "off": 2
      }
    ]
  }
]
```

Champs d'un agent :

| Champ                                                                       | Signification                                                                                                                    |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `host`                                                                      | adresse IP ou nom d'hôte (obligatoire)                                                                                           |
| `port`                                                                      | port UDP, 161 par défaut                                                                                                         |
| `name`                                                                      | nom dans Gladys                                                                                                                  |
| `id`                                                                        | ce sur quoi Gladys identifie l'appareil. À remplir si l'adresse IP peut changer : changer `id` ou `host` crée un nouvel appareil |
| `version`                                                                   | `1`, `2c` ou `3` (celle de la configuration par défaut)                                                                          |
| `community`                                                                 | communauté v1/v2c de cet équipement                                                                                              |
| `user`, `auth_protocol`, `auth_key`, `priv_protocol`, `priv_key`, `context` | réglages SNMPv3 de cet équipement                                                                                                |
| `profiles`                                                                  | `host`, `ups`, `interfaces`                                                                                                      |
| `interfaces`                                                                | les interfaces à suivre, par index ou par nom (16 au plus)                                                                       |
| `oids`                                                                      | vos propres OID, voir ci-dessous                                                                                                 |
| `refresh`                                                                   | intervalle de rafraîchissement de cet équipement, en secondes (60 minimum)                                                       |
| `mac`                                                                       | adresse MAC de la machine, pour la réveiller avec l'action de scène **Réveiller un agent SNMP** (Wake-on-LAN)                    |
| `wake_address`                                                              | adresse de diffusion du paquet Wake-on-LAN (`192.168.1.255`), si la machine ignore celle par défaut                              |

**Interfaces.** Chaque interface donne trois fonctionnalités : lien (1 =
actif), débit entrant et débit sortant en kbit/s. Utilisez **Lister les
interfaces** (plus bas) pour trouver l'index ou le nom à écrire. Les débits
se calculent entre deux interrogations : ils apparaissent à partir de la
deuxième.

**OID personnalisés.** Seul `oid` est obligatoire : la valeur s'affiche comme
un nombre brut. Ajoutez :

- `category`, `type`, `unit` — la fonctionnalité Gladys (ex.
  `temperature-sensor` / `decimal` / `celsius`, `energy-sensor` / `power` /
  `watt`) ; `text` / `text` affiche un texte ;
- `scale` — multiplie la valeur brute (`0.1` pour des dixièmes de degré) ;
- `on` / `off` — les valeurs brutes qui veulent dire allumé et éteint, pour
  une fonctionnalité binaire ;
- `writable: true` — en fait un interrupteur que Gladys peut piloter (un SET
  SNMP avec `on` ou `off`) ; `set_type` vaut `integer` (par défaut),
  `unsigned` ou `string`. Il faut une communauté en **lecture-écriture** sur
  cet équipement seulement ;
- `key` — le nom stable de la fonctionnalité (par défaut, construit à partir
  de l'OID) ;
- `min` / `max` — la plage de la fonctionnalité.

### Accès SNMP

- **Version SNMP** — utilisée par chaque agent qui ne fixe pas la sienne.
- **Communauté** — v1/v2c, `public` si laissée vide.
- **SNMPv3** — utilisateur, protocole et clé d'authentification, protocole et
  clé de chiffrement. Le niveau de sécurité découle de ce que vous remplissez :
  un utilisateur seul donne `noAuthNoPriv`, avec une clé d'authentification
  `authNoPriv`, avec les deux clés `authPriv`.

### Interrogation

- **Intervalle de rafraîchissement** — fréquence de lecture de chaque
  équipement, 60 secondes au moins (Gladys interroge au plus une fois par
  minute). Chaque valeur va dans l'historique : sur un grand réseau, préférez
  300 secondes.
- **Délai d'attente** et **Nouvelles tentatives** — combien de temps et
  combien de fois attendre une réponse avant de dire qu'un équipement est
  injoignable.
- **Journaux détaillés** — journalise chaque échec SNMP, pour comprendre un
  équipement qui ne répond pas. Les communautés et les clés ne sont jamais
  journalisées.

Enregistrez : les appareils apparaissent dans l'onglet **Découverte**, prêts
à être ajoutés.

## Ce que vous obtenez

Chaque appareil a :

| Fonctionnalité   | Signification                                                  |
| ---------------- | -------------------------------------------------------------- |
| Joignable        | 1 quand l'équipement répond en SNMP, 0 quand il ne répond plus |
| Temps de réponse | temps de réponse, en millisecondes                             |
| Uptime           | jours depuis le (re)démarrage de l'équipement                  |

La carte de l'appareil affiche aussi un badge **local**, ou **injoignable**
quand l'équipement ne répond plus.

## Actions

- **Tester la connexion** — lit tous les équipements tout de suite et dit,
  pour chacun, s'il a répondu, en combien de temps, et son nom système. Les
  erreurs de la liste des agents s'affichent aussi ici.
- **Lister les interfaces** — les interfaces d'un équipement : index, nom, et
  ▲ pour celles qui ont un lien. Copiez l'index ou le nom dans sa liste
  `interfaces`.
- **Parcourir un OID** — les objets sous un OID (20 lignes par défaut), pour
  trouver celui à ajouter dans `oids`. `1.3.6.1.2.1.1` est le groupe système,
  `1.3.6.1.4.1` les MIB des constructeurs.

## Scènes et tableau de bord (Gladys 5.1)

### Déclencheurs

- **Un agent SNMP ne répond plus** — un équipement qui répondait a manqué la
  dernière interrogation. Variables : `device_name`, `host`, `error`.
- **Un agent SNMP répond de nouveau** — variables : `device_name`, `host`,
  `downtime_minutes`.
- **Une interface réseau change d'état** — filtre sur actif, tombé ou les
  deux. Variables : `device_name`, `interface`, `status`.

Ils se déclenchent une fois par changement, jamais à chaque interrogation. Un
équipement déjà éteint au démarrage de Gladys ne déclenche rien.

Pour un seuil (un disque à plus de 90 %, une batterie sous 30 %), utilisez le
déclencheur habituel de Gladys **valeur d'un appareil** sur la
fonctionnalité.

### Actions

- **Lire une valeur SNMP** — un OID d'un équipement. Sorties : `success`,
  `value` (texte), `number`, `error`.
- **Écrire une valeur SNMP** — un OID, en entier, non signé ou texte :
  couper une prise de PDU, relancer un port PoE… Sorties : `success`, `error`.
- **Interroger un agent SNMP maintenant** — lit un équipement sans attendre.
  Sorties : `reachable`, `response_time`.
- **Réveiller un agent SNMP (Wake-on-LAN)** — envoie un paquet Wake-on-LAN à
  la machine d'un équipement déclaré avec son `mac` dans la forme JSON (un NAS
  ou un serveur en veille). C'est Gladys qui émet le paquet sur votre réseau.
  Sorties : `sent`, `error`. `sent` signifie que le paquet est parti, pas que
  la machine s'est réveillée : interrogez l'agent une minute plus tard.

Une action qui échoue n'arrête jamais la scène : testez `success` (ou
`reachable`) dans une condition juste après.

### Widget

Le widget **Agents SNMP** montre combien d'équipements répondent, une ligne
par équipement avec son temps de réponse, et un bouton **Interroger**.
Choisissez un équipement dans ses réglages pour voir aussi ses valeurs en
direct (temps de réponse, uptime, CPU, mémoire, batterie…).

## Dépannage

- **Le scan ne trouve rien** — vérifiez la communauté et la version dans
  _Accès SNMP_, et que l'équipement est sur le même réseau local que le
  serveur Gladys. Un équipement qui ignore le broadcast, ou en SNMP v3
  uniquement, se déclare à la main.
- **Un équipement reste injoignable** — vérifiez que SNMP est activé, que la
  communauté (ou l'utilisateur et les clés v3) est juste, et que l'équipement
  accepte les requêtes de l'adresse de votre serveur Gladys. Activez les
  **Journaux détaillés** et lancez **Tester la connexion**.
- **Joignable, mais un profil n'affiche rien** — l'équipement n'a pas cette
  MIB (beaucoup de switchs n'ont pas HOST-RESOURCES). Utilisez **Parcourir un
  OID** pour voir ce qu'il propose, et ajoutez des OID personnalisés.
- **Un nom d'interface est introuvable** — lancez **Lister les interfaces** et
  copiez le nom exactement, ou utilisez l'index.
- **Un interrupteur ne commute pas** — la communauté de cet équipement doit
  être en lecture-écriture, et `on` / `off` doivent être les valeurs attendues
  par la MIB du constructeur.
