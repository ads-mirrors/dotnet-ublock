/*******************************************************************************

    uBlock Origin - a comprehensive, efficient content blocker
    Copyright (C) 2017-present Raymond Hill

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see {http://www.gnu.org/licenses/}.

    Home: https://github.com/gorhill/uBlock
*/

/******************************************************************************/

//                example.com: domain => no slash
//           example.com/toto: domain + path => slash
//         /example\d+\.com$/: domain regex: no literal slash in regex
// /example\d+\.com\/toto\d+/: domain + path => literal slash in regex

/******************************************************************************/

const naivePathnameFromURL = url => {
    if ( typeof url !== 'string' ) { return; }
    const hnPos = url.indexOf('://');
    if ( hnPos === -1 ) { return; }
    const pathPos = url.indexOf('/', hnPos+3);
    if ( pathPos === -1 ) { return; }
    return url.slice(pathPos);
};

/******************************************************************************/

export class StaticExtFilteringHostnameDB {
    static VERSION = 1;
    constructor() {
        this.size = 0;
    }

    #hostnameToListMap = new Map();
    #hostnameToPathMap = new Map();
    #regexToMatcherMap = new Map();
    #strSlots = [ '' ];     // Array of strings (selectors and pseudo-selectors)
    #strLists = [ 0, 0 ];   // Array of integer pairs
    #regexMap = new Map();
    #strToSlotMap = new Map();
    #cleanupTimer = vAPI.defer.create(( ) => {
        this.#strToSlotMap.clear();
    });;

    store(hn, s) {
        this.size += 1;
        let iStr = this.#strToSlotMap.get(s);
        if ( iStr === undefined ) {
            iStr = this.#strSlots.length;
            this.#strSlots.push(s);
            this.#strToSlotMap.set(s, iStr);
            if ( this.#cleanupTimer.ongoing() === false ) {
                this.collectGarbage(true);
            }
        }
        if ( hn.charCodeAt(0) === 0x2F /* / */ ) {
            return this.#storeRegexMatching(hn, iStr);
        }
        if ( hn.includes('/') ) {
            return this.#storePathMatching(hn, iStr);
        }
        const iList = this.#hostnameToListMap.get(hn);
        this.#hostnameToListMap.set(hn, this.#strLists.length);
        this.#strLists.push(iStr, iList !== undefined ? iList : 0);
    }

    #storeRegexMatching(s, iStr) {
        const regex = s.slice(1, -1);
        const pathPos = regex.indexOf('\\/');
        const matcher = this.#regexToMatcherMap.get(s) ?? {
            rehn: pathPos === -1 ? regex : `${regex.slice(0, pathPos)}$`,
            iList: 0
        };
        if ( pathPos !== -1 ) {
            matcher.repn = `^${regex.slice(pathPos)}`;
        }
        if ( matcher.iList === 0 ) {
            this.#regexToMatcherMap.set(s, matcher);
        }
        const iList = this.#strLists.length;
        this.#strLists.push(iStr, matcher.iList);
        matcher.iList = iList;
    }

    #storePathMatching(s, iStr) {
        const pathPos = s.indexOf('/');
        const hn = s.slice(0, pathPos);
        const path = s.slice(pathPos);
        const pathMap = this.#hostnameToPathMap.get(hn) ?? new Map();
        if ( pathMap.size === 0 ) {
            this.#hostnameToPathMap.set(hn, pathMap);
        }
        const iList = pathMap.get(path) ?? 0;
        pathMap.set(path, this.#strLists.length);
        this.#strLists.push(iStr, iList);
    }

    clear() {
        this.#hostnameToListMap.clear();
        this.#hostnameToPathMap.clear();
        this.#regexToMatcherMap.clear();
        this.#strLists = [ 0, 0 ];
        this.#strSlots = [ '' ];
        this.#strToSlotMap.clear();
        this.#regexMap.clear();
        this.size = 0;
    }

    collectGarbage(later = false) {
        if ( later ) {
            return this.#cleanupTimer.onidle(5000, { timeout: 5000 });
        }
        this.#cleanupTimer.off();
        this.#strToSlotMap.clear();
    }

    retrieveSpecifics(out, hostname, url) {
        let hn = hostname;
        if ( hn === '' ) { return; }
        for (;;) {
            const iList = this.#hostnameToListMap.get(hn);
            if ( iList !== undefined ) {
                this.#retrieveFromSlot(out, iList);
            }
            if ( url !== undefined ) {
                this.#retrievePathBased(out, hn, url);
            }
            const pos = hn.indexOf('.');
            if ( pos === -1 ) { break; }
            hn = hn.slice(pos + 1);
            if ( hn === '*' ) { break; }
        }
    }

    #retrievePathBased(out, hn, url) {
        const pathMap = this.#hostnameToPathMap.get(hn);
        if ( pathMap === undefined ) { return; }
        const pathname = naivePathnameFromURL(url) ?? '';
        for ( const [ path, iList ] of pathMap ) {
            if ( pathname.startsWith(path) === false ) { continue; }
            this.#retrieveFromSlot(out, iList);
        }
    }

    retrieveGenerics(out) {
        let iList = this.#hostnameToListMap.get('');
        if ( iList ) { this.#retrieveFromSlot(out, iList); }
        iList = this.#hostnameToListMap.get('*');
        if ( iList ) { this.#retrieveFromSlot(out, iList); }
    }

    retrieveRegexBased(out, hostname, url) {
        if ( this.#regexToMatcherMap.size === 0 ) { return; }
        let pathname;
        for ( const matcher of this.#regexToMatcherMap.values() ) {
            const { rehn, repn } = matcher;
            let re = this.#regexMap.get(rehn);
            if ( re === undefined ) {
                this.#regexMap.set(rehn, (re = new RegExp(rehn)));
            }
            if ( re.test(hostname) === false ) { continue; }
            if ( repn ) {
                let re = this.#regexMap.get(repn);
                if ( re === undefined ) {
                    this.#regexMap.set(repn, (re = new RegExp(repn)));
                }
                if ( pathname === undefined ) {
                    pathname = naivePathnameFromURL(url) ?? '';
                }
                if ( re.test(pathname) === false ) { continue; }
            }
            this.#retrieveFromSlot(out, matcher.iList);
        }
    }

    #retrieveFromSlot(out, iList) {
        if ( iList === undefined ) { return; }
        do {
            const iStr = this.#strLists[iList+0];
            out.add(this.#strSlots[iStr]);
            iList = this.#strLists[iList+1];
        } while ( iList !== 0 );
    }

    toSelfie() {
        return {
            VERSION: StaticExtFilteringHostnameDB.VERSION,
            hostnameToListMap: this.#hostnameToListMap,
            hostnameToPathMap: this.#hostnameToPathMap,
            regexToMatcherMap: this.#regexToMatcherMap,
            strLists: this.#strLists,
            strSlots: this.#strSlots,
            size: this.size
        };
    }

    fromSelfie(selfie) {
        if ( typeof selfie !== 'object' || selfie === null ) { return; }
        if ( selfie.VERSION !== StaticExtFilteringHostnameDB.VERSION ) {
            throw new TypeError('Bad selfie');
        }
        this.#hostnameToListMap = selfie.hostnameToListMap;
        this.#hostnameToPathMap = selfie.hostnameToPathMap;
        this.#regexToMatcherMap = selfie.regexToMatcherMap;
        this.#strLists = selfie.strLists;
        this.#strSlots = selfie.strSlots;
        this.size = selfie.size;
    }
}

/******************************************************************************/
