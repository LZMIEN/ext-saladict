import { AddConfig, SyncService } from '../../interface'
import { getNotebook, notifyError } from '../../helpers'
import { openURL } from '@/_helpers/browser-api'
import { timer } from '@/_helpers/promise-more'
import { isFirefox } from '@/_helpers/saladict'
import { I18nManager } from '@/background/i18n-manager'

export interface SyncConfig {
  enable: boolean
}

export class Service extends SyncService<SyncConfig> {
  static readonly id = 'shanbay'

  static getDefaultConfig(): SyncConfig {
    return {
      enable: false
    }
  }

  static openLogin() {
    return openURL('https://www.shanbay.com/web/account/login')
  }

  async init() {
    if (!(await this.isLogin())) {
      throw new Error('login')
    }
  }

  async add(config: AddConfig) {
    await this.addInternal(config)
  }

  /**
   * @returns failed words
   */
  async addInternal({ words, force }: AddConfig): Promise<number> {
    if (!this.config.enable) {
      return 0
    }

    if (!(await this.isLogin())) {
      this.notifyLogin()
      return 0
    }

    if (force) {
      words = await getNotebook()
    }

    if (!words || words.length <= 0) {
      return 0
    }

    let errorCount = 0

    for (let i = 0; i < words.length; i++) {
      try {
        await this.addWord(words[i].text)
      } catch (error) {
        if (error !== 'word') {
          throw error
        }
        errorCount += 1
        notifyError(Service.id, 'word', `「${words[i].text}」`)
      }

      if ((i + 1) % 50 === 0) {
        await timer(15 * 60000)
      } else {
        await timer(500)
      }
    }

    return errorCount
  }

  async addWord(text: string) {
    try {
      const url =
        'http://www.shanbay.com/api/v1/bdc/search/?word=' +
        encodeURIComponent(text)
      var resSearch = await fetch(url).then(r => r.json())
    } catch (e) {
      throw new Error('network')
    }

    if (!resSearch || !resSearch.data) {
      throw new Error('word')
    }

    try {
      var resLearning = await fetch(
        'http://www.shanbay.com/api/v1/bdc/learning/',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: `content_type=vocabulary&id=${resSearch.data.id}`
        }
      ).then(r => r.json())
    } catch (e) {
      if (process.env.DEBUG) {
        console.error(e)
      }
      throw new Error('network')
    }

    if (!resLearning || resLearning.status_code !== 0) {
      throw new Error('word')
    }
  }

  async isLogin(): Promise<boolean> {
    return Boolean(
      await browser.cookies.get({
        url: 'http://www.shanbay.com',
        name: 'auth_token'
      })
    )
  }

  async notifyLogin() {
    const { i18n } = await I18nManager.getInstance()
    await i18n.loadNamespaces('sync')

    browser.notifications.onClicked.addListener(handleLoginNotification)
    browser.notifications.onClosed.removeListener(removeNotificationHandler)
    if (browser.notifications.onButtonClicked) {
      browser.notifications.onButtonClicked.addListener(handleLoginNotification)
    }

    const options: browser.notifications.CreateNotificationOptions = {
      type: 'basic',
      iconUrl: browser.runtime.getURL(`assets/icon-128.png`),
      title: `Saladict ${i18n.t(`sync:shanbay.title`)}`,
      message: i18n.t('sync:shanbay.error.login'),
      eventTime: Date.now() + 10000,
      priority: 2
    }

    if (!isFirefox) {
      options.buttons = [{ title: i18n.t('sync:shanbay.open') }]
    }

    browser.notifications.create('shanbay-login', options)
  }
}

function handleLoginNotification(id: string) {
  if (id === 'shanbay-login') {
    Service.openLogin()
    removeNotificationHandler(id)
  }
}

function removeNotificationHandler(id: string) {
  if (id === 'shanbay-login') {
    browser.notifications.onClicked.removeListener(handleLoginNotification)
    browser.notifications.onClosed.removeListener(removeNotificationHandler)
    if (browser.notifications.onButtonClicked) {
      browser.notifications.onButtonClicked.removeListener(
        handleLoginNotification
      )
    }
  }
}
