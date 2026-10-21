import { pluginState } from '../../core/state';
import { createWeiboReader } from '../../weibo/reader';
import { browserService } from '../browser/service';

export const weiboReader = createWeiboReader({
    fetchApi: (urlPath) => browserService.fetchApi(urlPath),
    renderHtml: (html) => browserService.renderHtml(html),
    logger: {
        debug(...args) {
            pluginState.logger.debug(...args);
        },
        warn(...args) {
            pluginState.logger.warn(...args);
        },
    },
});
